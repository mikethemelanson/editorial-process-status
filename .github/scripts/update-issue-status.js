import { graphql } from "@octokit/graphql";
import { context } from "@actions/github";

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

const issueNumber = context.payload.issue.number;
const owner = context.repo.owner;
const repo = context.repo.repo;

// GitHub Project constants - UPDATED FOR REPOSITORY PROJECT
const PROJECT_NUMBER = 3; // Update this to your actual project number

(async () => {
  try {
    // Get issue data using REST API
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    const issue = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const body = issue.data.body;
    if (!body) {
      console.log(`Issue #${issueNumber} has no body`);
      return;
    }

    console.log("Processing issue body:", body.substring(0, 200) + "...");

    const checklistItems = [
      "Submit draft (author/submitter)",
      "Review draft & triage (blog team)",
      "Content team reviews & edits (editors)",
      "Team stakeholders approval (sponsor/approver)",
      "Add to GitHub Blog calendar (blog team)",
      "Communications review (comms reviewer)",
      "Copy edit (blog team)",
      "Stage post in WordPress (blog team)",
      "Post preview approval (author/submitter)",
      "Schedule publication in WordPress (blog team)",
      "Open social media issue (blog team)",
    ];

    // Count consecutive completed items
    let consecutiveCount = 0;
    
    for (let i = 0; i < checklistItems.length; i++) {
      const item = checklistItems[i];
      const regex = new RegExp(`- *\\[[xX]\\] *${escapeRegExp(item)}`, "i");
      
      if (regex.test(body)) {
        console.log(`Found completed item: ${item}`);
        consecutiveCount++;
      } else {
        // Break at first unchecked box
        console.log(`Breaking at unchecked item: ${item}`);
        break;
      }
    }

    console.log(`Total consecutive completed items: ${consecutiveCount}`);
    
    // Determine status value based on completed checklist items
    let statusValue;
    if (consecutiveCount >= 11) {
      statusValue = "11. Ready for promotion";
    } else if (consecutiveCount >= 10) {
      statusValue = "10. Scheduled to publish";
    } else if (consecutiveCount >= 9) {
      statusValue = "9. Ready to schedule";
    } else if (consecutiveCount >= 8) {
      statusValue = "8. Preview approval";
    } else if (consecutiveCount >= 7) {
      statusValue = "7. Ready for staging";
    } else if (consecutiveCount >= 6) {
      statusValue = "6. Copyedit";
    } else if (consecutiveCount >= 5) {
      statusValue = "5. Comms review";
    } else if (consecutiveCount >= 4) {
      statusValue = "4. Ready for calendar";
    } else if (consecutiveCount >= 3) {
      statusValue = "3. Team and stakeholder reviews";
    } else if (consecutiveCount >= 2) {
      statusValue = "2. Content team reviews";
    } else if (consecutiveCount >= 1) {
      statusValue = "1. Draft submitted";
    } else {
      statusValue = "0. Needs draft";
    }

    // Step 1: Get the project ID - UPDATED FOR REPOSITORY PROJECT
    const projectData = await graphqlWithAuth(`
      query {
        user(login: "${owner}") {
          projectV2(number: ${PROJECT_NUMBER}) {
            id
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `);

    const project = projectData.user.projectV2;
    console.log(`Found project with ID: ${project.id}`);

    // Step 2: Find the status field and the appropriate option ID
    const statusField = project.fields.nodes.find(
      field => field.name.toLowerCase() === "status"
    );

    if (!statusField) {
      console.log("Available fields:", project.fields.nodes.map(field => field.name));
      throw new Error("Status field not found in the project");
    }

    console.log("Status field options:", statusField.options.map(opt => opt.name));
    
    const statusOption = statusField.options.find(
      option => option.name === statusValue
    );

    if (!statusOption) {
      throw new Error(`Status option '${statusValue}' not found in the field options`);
    }

    // Step 3: Get the item ID for this issue in the project
    const itemData = await graphqlWithAuth(`
      query {
        user(login: "${owner}") {
          projectV2(number: ${PROJECT_NUMBER}) {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on Issue {
                    repository {
                      name
                      owner {
                        login
                      }
                    }
                    number
                  }
                }
              }
            }
          }
        }
      }
    `);

    const projectItem = itemData.user.projectV2.items.nodes.find(
      item => 
        item.content?.number === issueNumber && 
        item.content?.repository?.name === repo &&
        item.content?.repository?.owner?.login === owner
    );

    if (!projectItem) {
      console.log(`Issue #${issueNumber} not found in the project, adding it now`);
      
      // Add the issue to the project
      const addResult = await graphqlWithAuth(`
        mutation {
          addProjectV2ItemById(input: {
            projectId: "${project.id}"
            contentId: "${issue.data.node_id}"
          }) {
            item {
              id
            }
          }
        }
      `);
      
      const newItemId = addResult.addProjectV2ItemById.item.id;
      console.log(`Added issue to project, item ID: ${newItemId}`);
      
      // Update the status field for the newly added item
      await graphqlWithAuth(`
        mutation {
          updateProjectV2ItemFieldValue(input: {
            projectId: "${project.id}"
            itemId: "${newItemId}"
            fieldId: "${statusField.id}"
            value: { 
              singleSelectOptionId: "${statusOption.id}"
            }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `);
      
      console.log(`Updated status to "${statusValue}" for issue #${issueNumber}`);
    } else {
      // Update the status field for the existing item
      await graphqlWithAuth(`
        mutation {
          updateProjectV2ItemFieldValue(input: {
            projectId: "${project.id}"
            itemId: "${projectItem.id}"
            fieldId: "${statusField.id}"
            value: { 
              singleSelectOptionId: "${statusOption.id}"
            }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `);
      
      console.log(`Updated status to "${statusValue}" for issue #${issueNumber}`);
    }

  } catch (error) {
    console.error(`Error updating issue status: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
})();

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
