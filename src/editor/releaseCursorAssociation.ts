import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const releaseCursorAssociation = EditorView.domEventHandlers({
  blur(_event, view) {
    const selection = view.state.selection;
    const cursor = selection.main;
    if (cursor.empty && cursor.assoc !== 0) {
      view.dispatch({
        selection: selection.replaceRange(
          EditorSelection.cursor(cursor.head, 0, cursor.bidiLevel ?? undefined, cursor.goalColumn)
        ),
      });
    }
  },
});
