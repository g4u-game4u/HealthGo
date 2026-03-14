# Implementation Plan: App Enhancements

## Overview

Incremental implementation of Factory Task Tracker enhancements: self-assigned actions, approval flow, updated status display, auto-delivery (logout + 18:00 BRT timer), user points display, and reference folder cleanup. All changes are vanilla JS with ES modules. Property-based tests use fast-check via Vitest.

## Tasks

- [x] 1. Update ApiClient with new API methods and fix status fetching
  - [x] 1.1 Add `getActionTemplates()` method to ApiClient
    - Implement GET /action call returning array of action templates
    - _Requirements: 1.1_

  - [x] 1.2 Add `createSelfAssignedAction(params)` method to ApiClient
    - POST /game/action/process with status "DONE", user_email, action_id, comments: ["[SELF-ASSIGNED]"], approved: false, finished_at, delivery_id, integration_id
    - _Requirements: 1.2_

  - [x] 1.3 Add `completeDelivery(deliveryId, finishedAt)` method to ApiClient
    - POST /game/delivery/{deliveryId}/complete with body { finished_at } and header client_id
    - _Requirements: 4.2_

  - [x] 1.4 Add `getUserData(userId)` method to ApiClient
    - GET /user/{userId} with header client_id, returns user object with locked_points, unlocked_points
    - _Requirements: 6.1_

  - [x] 1.5 Update `getTasks()` to fetch PENDING, DOING, DONE only (remove DELIVERED)
    - Replace DELIVERED fetch with DOING fetch in the Promise.all
    - _Requirements: 3.1, 3.5_

- [x] 2. Implement task-utils.js extensions and self-assigned identification
  - [x] 2.1 Add `isSelfAssigned(task)` function to task-utils.js
    - Check if task's comments array contains "[SELF-ASSIGNED]" string
    - Return true if marker found, false otherwise (handle null/undefined/empty comments)
    - _Requirements: 2.4_

  - [x] 2.2 Write property test for self-assigned identification (Property 2)
    - **Property 2: Self-assigned identification**
    - Generate random comment arrays with/without "[SELF-ASSIGNED]" marker, verify `isSelfAssigned` returns correct boolean
    - File: tests/property/self-assigned.property.test.js
    - **Validates: Requirements 2.4**

  - [x] 2.3 Update task list partitioning logic in task-utils.js
    - To-Do list: tasks with status PENDING or DOING
    - Completed list: tasks with status DONE
    - Exclude DELIVERED from all lists
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 2.4 Write property test for task list partitioning (Property 4)
    - **Property 4: Task list partitioning by status**
    - Generate random task arrays with mixed statuses, verify PENDING/DOING in to-do, DONE in completed, DELIVERED in neither
    - File: tests/property/task-partitioning.property.test.js
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [x] 2.5 Update `renderTaskCard` to show "Awaiting approval" badge for self-assigned DONE tasks
    - Add distinct background color and "Awaiting approval" label for self-assigned tasks in completed list
    - _Requirements: 2.2, 2.3_

  - [x] 2.6 Write property test for self-assigned rendering (Property 3)
    - **Property 3: Self-assigned rendering with approval badge**
    - Generate random self-assigned DONE tasks, verify rendered HTML contains "Awaiting approval" indicator
    - File: tests/property/self-assigned.property.test.js
    - **Validates: Requirements 2.2, 2.3**

- [x] 3. Checkpoint - Core utilities and API layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement self-assigned action creation UI flow
  - [x] 4.1 Add new state fields to StateManager
    - Add `userPoints`, `autoDeliveryTimerId`, `actionTemplates`, `isActionModalOpen` to initial state
    - _Requirements: 1.1, 6.1_

  - [x] 4.2 Add "+" button to task list header in index.html and app.js
    - Render "+" icon at top of task list, visible only when authenticated
    - On tap: call `ApiClient.getActionTemplates()` and display selection modal
    - _Requirements: 1.3_

  - [x] 4.3 Implement action template selection modal in app.js
    - Display list of templates from GET /action
    - On selection: call `ApiClient.createSelfAssignedAction()` with selected template, user email, and [SELF-ASSIGNED] marker
    - On success: refresh task list
    - On failure: show error toast with failure reason, task list unchanged
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 4.4 Write property test for self-assigned payload correctness (Property 1)
    - **Property 1: Self-assigned payload correctness**
    - Generate random template IDs and emails, verify payload has status "DONE", correct user_email, action_id, and "[SELF-ASSIGNED]" in comments
    - File: tests/property/self-assigned.property.test.js
    - **Validates: Requirements 1.2, 2.1**

  - [x] 4.5 Write property test for task list invariant on failed creation (Property 11)
    - **Property 11: Task list invariant on failed creation**
    - Generate random task lists, simulate creation failure, verify list is deeply equal before and after
    - File: tests/property/self-assigned.property.test.js
    - **Validates: Requirements 1.4**

- [x] 5. Implement auto-delivery module
  - [x] 5.1 Create auto-delivery.js module with `getDeliverableActions(tasks)`
    - Filter tasks: status === "DONE", NOT self-assigned, finished_at is today (BRT)
    - Return flat array of eligible sub-tasks
    - _Requirements: 4.1, 4.7_

  - [x] 5.2 Write property test for deliverable action filtering (Property 5)
    - **Property 5: Deliverable action filtering**
    - Generate random task arrays with mixed types/dates, verify only admin-assigned DONE tasks from today (BRT) are returned
    - File: tests/property/auto-delivery.property.test.js
    - **Validates: Requirements 4.1, 4.7**

  - [x] 5.3 Implement `executeDeliveries(deliverableActions)` in auto-delivery.js
    - Call POST /game/delivery/{deliveryId}/complete for each action
    - Handle 200 (success), 204 (log and continue), network error (log and continue)
    - Return { succeeded, failed, errors }
    - _Requirements: 4.2, 4.3, 4.4, 4.6_

  - [x] 5.4 Write property test for delivery resilience (Property 6)
    - **Property 6: Delivery resilience**
    - Generate random deliverable lists with simulated failures, verify all N actions are attempted regardless of individual failures
    - File: tests/property/auto-delivery.property.test.js
    - **Validates: Requirements 4.6**

  - [x] 5.5 Implement `scheduleEndOfDayDelivery()` and `cancelScheduledDelivery(timerId)` in auto-delivery.js
    - Calculate milliseconds until next 18:00 BRT (21:00 UTC)
    - If current time >= 18:00 BRT, schedule for next day
    - Use setTimeout, return timer ID
    - On trigger: execute same delivery logic as logout, show error toast if partial failures
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 5.6 Write property test for 18:00 BRT timer calculation (Property 7)
    - **Property 7: 18:00 BRT timer calculation**
    - Generate random timestamps, verify computed delay targets next 18:00 BRT correctly
    - File: tests/property/auto-delivery.property.test.js
    - **Validates: Requirements 5.1, 5.3**

  - [x] 5.7 Write property test for failed delivery error message (Property 8)
    - **Property 8: Failed delivery error message**
    - Generate random positive integers N, verify error toast message contains N as substring
    - File: tests/property/auto-delivery.property.test.js
    - **Validates: Requirements 5.5**

- [x] 6. Checkpoint - Auto-delivery and self-assigned creation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement user points display
  - [x] 7.1 Add points section UI to index.html and app.js
    - Render locked and unlocked points below header bar
    - Fetch points via `ApiClient.getUserData(userId)` on load and on task list refresh
    - Handle 401 → session expired (clear token, redirect to login)
    - Handle 404 → display 0/0
    - Handle network error → display last known values or 0/0
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.2 Write property test for points display rendering (Property 9)
    - **Property 9: Points display rendering**
    - Generate random non-negative integer pairs (locked, unlocked), verify HTML contains both values
    - File: tests/property/points.property.test.js
    - **Validates: Requirements 6.2**

  - [x] 7.3 Write property test for points fallback on network error (Property 10)
    - **Property 10: Points fallback on network error**
    - Generate random previous points state, simulate network error, verify displayed points equal previous state or 0/0
    - File: tests/property/points.property.test.js
    - **Validates: Requirements 6.6**

- [x] 8. Wire auto-delivery into logout and timer into login
  - [x] 8.1 Update logout flow in app.js
    - Before clearing state: call `AutoDelivery.getDeliverableActions()` then `AutoDelivery.executeDeliveries()`
    - Cancel 18:00 BRT timer via `AutoDelivery.cancelScheduledDelivery()`
    - After deliveries: clear token, reset state, redirect to login
    - _Requirements: 4.1, 4.2, 4.5, 5.4_

  - [x] 8.2 Schedule 18:00 BRT timer on login in app.js
    - After successful authentication: call `AutoDelivery.scheduleEndOfDayDelivery()`
    - Store timer ID in StateManager
    - _Requirements: 5.1, 5.2_

- [x] 9. Checkpoint - Full feature integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Reference folder cleanup
  - [x] 10.1 Verify no application code references referencia/ directory
    - Search all JS/HTML files for imports or references to referencia/
    - _Requirements: 7.2_

  - [x] 10.2 Delete the referencia/ directory
    - Remove the entire referencia/ folder from the project root
    - _Requirements: 7.1_

- [x] 11. Final checkpoint - All enhancements complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests use fast-check with minimum 100 iterations via Vitest
- Checkpoints ensure incremental validation at logical breakpoints
- Auto-delivery logic is shared between logout (task 8.1) and 18:00 BRT timer (task 8.2) via the auto-delivery.js module
