import { closeHistory } from '@tiptap/pm/history';
import { Step, StepResult } from '@tiptap/pm/transform';

export class FrontmatterStep extends Step {
  constructor(before, after) {
    super();
    this.before = before;
    this.after = after;
  }

  apply(doc) {
    return StepResult.ok(doc);
  }

  invert() {
    return new FrontmatterStep(this.after, this.before);
  }

  map() {
    return this;
  }

  toJSON() {
    return { stepType: 'taglineFrontmatter', before: this.before, after: this.after };
  }

  static fromJSON(_schema, json) {
    return new FrontmatterStep(json.before, json.after);
  }
}

Step.jsonID('taglineFrontmatter', FrontmatterStep);

export function recordFrontmatter(editor, before, after) {
  editor.view.dispatch(closeHistory(editor.state.tr).step(new FrontmatterStep(before, after)));
  editor.view.dispatch(closeHistory(editor.state.tr));
}
