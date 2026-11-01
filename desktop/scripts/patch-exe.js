/* Rewrite Windows icon and version resources for the portable executable/SFX.
   This must run before Authenticode signing. */
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [input, output, iconPath] = process.argv.slice(2);
  if (!input || !output || !iconPath) {
    throw new Error("usage: node patch-exe.js <input.exe> <output.exe> <icon.ico>");
  }
  const root = path.join(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const { load } = require("resedit/cjs");
  const ResEdit = await load();
  const PE = await import("pe-library");

  const source = fs.readFileSync(input);
  const exe = PE.NtExecutable.from(source, { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (!groups.length) throw new Error("executable has no icon group");
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      iconFile.icons.map((item) => item.data)
    );
  }

  const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (!versions.length) throw new Error("executable has no version resource");
  const parts = String(pkg.version || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const language = { lang: 1033, codepage: 1200 };
  const strings = {
    CompanyName: "Luogu Desktop",
    FileDescription: "洛谷桌面版",
    FileVersion: pkg.version,
    InternalName: "LuoguDesktop",
    LegalCopyright: "MIT License",
    OriginalFilename: "Luogu Desktop.exe",
    ProductName: "Luogu Desktop",
    ProductVersion: pkg.version,
  };
  for (const vi of versions) {
    vi.setFileVersion(parts[0], parts[1], parts[2] || 0, parts[3] || 0, language.lang);
    vi.setProductVersion(parts[0], parts[1], parts[2] || 0, parts[3] || 0, language.lang);
    const languages = vi.getAllLanguagesForStringValues();
    for (const lang of languages.length ? languages : [language]) {
      vi.setStringValues(lang, strings);
    }
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(output, Buffer.from(exe.generate()));
  console.log(`PATCHED ${path.basename(input)} -> ${path.basename(output)} icons=${groups.length} version=${pkg.version}`);
}

main().catch((err) => {
  console.error("patch-exe:", err && err.stack ? err.stack : err);
  process.exit(1);
});
