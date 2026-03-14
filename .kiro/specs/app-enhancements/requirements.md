# Requirements Document

## Introduction

This document specifies enhancements to the Factory Task Tracker application. The enhancements include: self-assigned actions (user-initiated tasks), a distinct approval flow for self-assigned actions, updated status display logic, automatic delivery of completed actions on logout or at 18:00 BRT, and a user points display. A final cleanup task removes the reference folder used during development.

## Glossary

- **App**: The Factory Task Tracker single-page web application (index.html, app.js, api-client.js, state-manager.js, task-utils.js, sync-queue.js)
- **Player**: An authenticated user of the App who executes actions
- **Gestor**: An administrator or leader who approves self-assigned actions
- **Action**: A task unit assigned to a Player, tracked via the G4U API with statuses PENDING, DOING, DONE, DELIVERED
- **Self_Assigned_Action**: An Action created by the Player (not assigned by a Gestor), which requires Gestor approval before becoming DELIVERED
- **Admin_Assigned_Action**: An Action assigned to the Player by a Gestor through the management system
- **Action_Template**: A predefined action type available in the G4U API (GET /action endpoint)
- **Delivery**: A grouping concept in the G4U API used to complete actions via POST /game/delivery/{deliveryId}/complete
- **Points**: Numeric score associated with a Player, consisting of locked and unlocked values, retrieved via GET /user/{id}
- **Status_PENDING**: Initial status of an Action that has not been started
- **Status_DOING**: Status of an Action that is in progress
- **Status_DONE**: Status of an Action that the Player has completed
- **Status_DELIVERED**: Status of an Action that has been delivered/confirmed
- **To_Do_List**: The UI section displaying Actions with status PENDING or DOING
- **Completed_List**: The UI section displaying Actions with status DONE
- **BRT**: Brazil Time, UTC-3 (GMT-3)
- **ApiClient**: The module in api-client.js responsible for all G4U API communication
- **UIController**: The module in app.js responsible for rendering and user interaction
- **StateManager**: The module in state-manager.js responsible for application state

## Requirements

### Requirement 1: Self-Assigned Action Creation

**User Story:** As a Player, I want to register an action that was not assigned to me by a Gestor, so that I can log additional work I performed on my own initiative.

#### Acceptance Criteria

1. WHEN the Player taps the add button, THE App SHALL display a list of available Action_Templates fetched from the G4U API (GET /action endpoint)
2. WHEN the Player selects an Action_Template from the list, THE App SHALL create a new Self_Assigned_Action by calling POST /game/action/process with status "DONE", the Player's user_email, the selected action_template_id, and a comments field containing a marker identifying the action as self-assigned
3. THE App SHALL display the add button as a "+" icon positioned at the top of the task list screen, visible only when the Player is authenticated
4. IF the API call to create the Self_Assigned_Action fails, THEN THE App SHALL display an error toast with the failure reason and retain the current task list unchanged
5. WHEN the Self_Assigned_Action is created successfully, THE App SHALL refresh the task list to include the new action

### Requirement 2: Self-Assigned Action Approval Flow

**User Story:** As a Player, I want self-assigned actions to be visually distinct and marked as awaiting approval, so that I can distinguish them from admin-assigned actions.

#### Acceptance Criteria

1. WHEN a Self_Assigned_Action is created, THE App SHALL set the action status to DONE immediately (skipping PENDING and DOING)
2. THE App SHALL render Self_Assigned_Actions in the Completed_List with a distinct visual indicator (different background color or badge) signaling that the action is awaiting Gestor approval
3. WHILE a Self_Assigned_Action has status DONE and has not been approved by a Gestor, THE App SHALL display an "awaiting approval" label on the action card
4. THE App SHALL identify Self_Assigned_Actions by checking for the self-assigned marker in the comments field of the action data

### Requirement 3: Updated Status Display

**User Story:** As a Player, I want the app to show only relevant action statuses, so that I can focus on pending work and recently completed actions.

#### Acceptance Criteria

1. THE App SHALL fetch Actions with statuses PENDING, DOING, and DONE from the G4U API (excluding DELIVERED from fetch)
2. THE App SHALL display Actions with status PENDING or DOING in the To_Do_List section
3. THE App SHALL display Actions with status DONE in the Completed_List section
4. THE App SHALL NOT display Actions with status DELIVERED in any list
5. WHEN the App fetches tasks, THE ApiClient SHALL query the user-action/search endpoint for statuses PENDING, DOING, and DONE only

### Requirement 4: Auto-Delivery on Logout

**User Story:** As a Player, I want all my completed actions to be automatically delivered when I log out, so that I do not have to manually deliver each action.

#### Acceptance Criteria

1. WHEN the Player taps the logout button, THE App SHALL identify all Admin_Assigned_Actions with status DONE that were completed on the current day (based on finished_at date)
2. WHEN the App identifies DONE Admin_Assigned_Actions for delivery, THE App SHALL call POST /game/delivery/{deliveryId}/complete for each action with request body {"finished_at": "<ISO 8601 timestamp>"} and header client_id set to the configured client identifier
3. IF the delivery API returns status 200, THEN THE App SHALL consider the action successfully delivered
4. IF the delivery API returns status 204, THEN THE App SHALL log the non-delivery and continue processing remaining actions
5. WHEN all delivery requests have been processed, THE App SHALL proceed with the standard logout flow (clear token, reset state, redirect to login)
6. IF a delivery API call fails with a network error, THEN THE App SHALL log the error and continue attempting delivery for remaining actions
7. THE App SHALL NOT attempt to auto-deliver Self_Assigned_Actions (only Admin_Assigned_Actions are auto-delivered)

### Requirement 5: Auto-Delivery at 18:00 BRT

**User Story:** As a Player, I want completed actions to be automatically delivered at 18:00 BRT if I am still logged in, so that actions are delivered at end of business even without logging out.

#### Acceptance Criteria

1. WHILE the Player is authenticated, THE App SHALL schedule a timer that triggers at 18:00 BRT (21:00 UTC) each day
2. WHEN the 18:00 BRT timer triggers, THE App SHALL execute the same auto-delivery logic as the logout flow (Requirement 4, criteria 1-4 and 7)
3. IF the Player logs in after 18:00 BRT on the current day, THEN THE App SHALL NOT trigger auto-delivery until 18:00 BRT on the next day
4. WHEN the Player logs out, THE App SHALL cancel the scheduled 18:00 BRT timer
5. IF the auto-delivery at 18:00 BRT fails for one or more actions, THEN THE App SHALL display an error toast summarizing the number of failed deliveries

### Requirement 6: User Points Display

**User Story:** As a Player, I want to see my current points (locked and unlocked) at the top of the screen, so that I can track my progress and rewards.

#### Acceptance Criteria

1. WHEN the Player is authenticated and the task list screen is displayed, THE App SHALL fetch the Player's data from GET /user/{id} with header client_id set to the configured client identifier
2. THE App SHALL display the Player's locked points and unlocked points in a points section positioned at the top of the task list screen, below the header bar
3. WHEN the App refreshes the task list, THE App SHALL also refresh the Player's points data
4. IF the GET /user/{id} endpoint returns status 401, THEN THE App SHALL trigger the session expired flow (clear token, redirect to login)
5. IF the GET /user/{id} endpoint returns status 404, THEN THE App SHALL display zero for both locked and unlocked points
6. IF the GET /user/{id} request fails with a network error, THEN THE App SHALL display the last known points values or zero if no previous values exist

### Requirement 7: Reference Folder Cleanup

**User Story:** As a developer, I want the reference folder deleted after development is complete, so that the repository does not contain unnecessary reference files.

#### Acceptance Criteria

1. WHEN all other requirements have been implemented and verified, THE developer SHALL delete the entire referencia/ directory from the project root
2. THE developer SHALL verify that no application code references or imports files from the referencia/ directory before deletion
