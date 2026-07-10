# Chrome Extension PRD: Purpose-based Content Filter

## 1. Overview
This project is a Chrome extension that filters YouTube and Instagram content based on purpose-driven packages such as study, workout, development, and reading. The extension hides or removes content that does not match the user-selected intent.

## 2. Problem Statement
Users often encounter distracting content while browsing video platforms. They want a lightweight way to filter out irrelevant content and keep only items aligned with a chosen purpose.

## 3. Product Goal
Provide a simple, real-time content filter that allows users to:
- select a purpose-based package,
- define include/exclude keywords,
- see filtering statistics, and
- apply the filter to supported platforms.

## 4. Target Users
- Users who want to focus on study, fitness, coding, or reading.
- Users who want a more intentional content feed on YouTube and Instagram.

## 5. Core Use Cases
1. A user selects a package such as study.
2. The extension filters videos/reels based on keywords tied to that package.
3. The user manages include/exclude keywords from the popup.
4. The user sees how many items were kept or removed.
5. The extension updates dynamically as the page changes.

## 6. Functional Requirements
### 6.1 Package Selection
- The user can choose a package from the popup.
- The selected package is stored and reused across sessions.

### 6.2 Keyword Management
- Each package has its own include/exclude keyword set.
- Users can add or remove keywords through a dedicated popup window.
- Keywords are stored per package.

### 6.3 Content Filtering
- Content on YouTube and Instagram is evaluated using a scoring model.
- Matching include keywords increase the score.
- Matching exclude keywords reduce the score.
- Content with a non-positive score is removed from view.

### 6.4 Real-time Updates
- When the user changes a package or keywords, the current tab is refreshed or reprocessed.
- Content added dynamically after page load is also processed.

### 6.5 Statistics Display
- The popup shows recent filtering statistics such as:
  - total processed items,
  - kept items,
  - removed items.

## 7. Non-Functional Requirements
- The extension should work on Chrome with Manifest V3.
- The UI should be lightweight and responsive.
- Storage access should be robust to avoid context invalidation issues.
- Filtering should run without major delays in normal usage.

## 8. Out of Scope
- Full AI-based semantic understanding.
- Cross-platform support beyond YouTube and Instagram.
- Advanced user accounts or cloud sync.

## 9. Current Implementation Status
Implemented:
- package selection UI,
- keyword management popup,
- per-package keyword storage,
- YouTube filtering,
- Instagram Reels filtering,
- live filtering updates,
- popup-based statistics display.

Pending/To Verify:
- end-to-end browser validation of the separate keyword popup flow,
- confirmation of immediate refresh behavior in a real browsing session.

## 10. Next Steps
- Test the keyword popup flow in Chrome.
- Confirm that adding/removing keywords updates the active tab correctly.
- Refine UI copy and UX polish.
- Add optional presets or import/export for keyword sets.
