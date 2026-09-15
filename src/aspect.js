import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject';

// Gtk.AspectFrame fits a child inside an existing allocation; it does not request
// a height from its width in a vertical scroller. This layout does both.
const AspectLayout = GObject.registerClass(
  class AspectLayout extends Gtk.LayoutManager {
    _init(ratio, minimumWidth, naturalWidth) {
      super._init();
      this.ratio = ratio;
      this.minimumWidth = minimumWidth;
      this.naturalWidth = naturalWidth;
    }

    vfunc_get_request_mode() {
      return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
    }

    vfunc_measure(_widget, orientation, forSize) {
      if (orientation === Gtk.Orientation.HORIZONTAL)
        return [this.minimumWidth, this.naturalWidth, -1, -1];
      const height = Math.round(
        (forSize < 0 ? this.naturalWidth : forSize) / this.ratio,
      );
      return [height, height, -1, -1];
    }

    vfunc_allocate(widget, width, height, baseline) {
      widget.get_first_child()?.allocate(width, height, baseline, null);
    }
  },
);

export const AspectBox = GObject.registerClass(
  class AspectBox extends Gtk.Box {
    _init({
      ratio = 16 / 9,
      thumbnail = false,
      child = null,
      ...properties
    } = {}) {
      super._init({ orientation: Gtk.Orientation.VERTICAL, ...properties });
      this._aspectLayout = new AspectLayout(
        ratio,
        thumbnail ? 140 : 280,
        thumbnail ? 210 : 640,
      );
      this.set_layout_manager(this._aspectLayout);
      if (child) this.append(child);
    }

    set_child(child) {
      if (this.get_first_child()) this.remove(this.get_first_child());
      this.append(child);
    }

    set_ratio(ratio) {
      this._aspectLayout.ratio = ratio;
      this._aspectLayout.layout_changed();
    }
  },
);
