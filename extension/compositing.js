// Mutter's unredirect inhibitor is reference-counted across Shell components.
// Hold exactly one reference while visible wallpaper needs Shell compositing.
export class CompositingHold {
  constructor(compositor) {
    this._compositor = compositor;
    this.held = false;
  }

  setRequired(required) {
    if (required === this.held) return false;
    if (required) this._compositor.disable_unredirect();
    else this._compositor.enable_unredirect();
    this.held = required;
    return true;
  }
}
