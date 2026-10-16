# Markdown preview modes

The toolbar above a Markdown file offers three views:

- **Preview** is the default reading view and follows the paginated or single-page reading preference.
- **Tree view** draws a downward tree with the file as its root at the top and connected heading nodes below. Subsections branch beneath their parents. Wide trees scroll horizontally and open centered on the root, including on phones. Selecting a heading opens its section in Preview. Files without headings show the file root and an empty-outline message.
- **Wrap all sections** renders the whole file with every heading's section collapsed. Expanding a heading reveals its content and its child headings; child sections remain collapsed until expanded individually. Disclosure controls stay visible on phones.

Returning to Preview expands the sections again. Opening a different file resets the view to Preview. These controls are hidden during source editing.

Wrapped sections use the existing DOM folding pass. Content stays mounted so highlight offsets remain stable, and the fold observer applies to blocks mounted later by progressive rendering.

Browser coverage lives in `tests/e2e/markdown-views.spec.ts`: both reading preferences, outline navigation, nested folding, file switches, empty outlines, and a 320px phone layout.
