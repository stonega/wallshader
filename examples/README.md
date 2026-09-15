# Preset example

`aurora.json` demonstrates the editable state accepted by `normalizePreset`.
Validate it with the same code used by the app:

```sh
bun -e 'import { normalizePreset } from "./src/catalog.js"; const data = await Bun.file("examples/aurora.json").json(); console.log(normalizePreset(data.id, data));'
```

The UI saves these objects inside `state.json`'s `presets` map. This version does
not offer an import dialog.
