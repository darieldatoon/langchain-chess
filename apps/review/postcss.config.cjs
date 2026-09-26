// Library mode inlines every font file into bundle.js, and Macaw's fonts in every subset and
// format would take most of the 5 MiB upload limit. Keep the latin subset as woff2 only.
const latinWoff2Only = {
  postcssPlugin: "latin-woff2-only",
  AtRule: {
    "font-face": (rule) => {
      const src = rule.nodes.find((node) => node.prop === "src");
      const woff2 = src?.value.split(/,\s*(?=url\()/).find((part) => part.includes("woff2"));
      if (!src || !woff2 || !/-latin-\d/.test(woff2)) return rule.remove();
      src.value = woff2;
    },
  },
};

module.exports = {
  plugins: [
    require("tailwindcss")({ config: "./tailwind.config.cjs" }),
    require("autoprefixer"),
    latinWoff2Only,
  ],
};
