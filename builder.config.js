// builder.config.js

require("dotenv").config();

const artifactProductName = "VE-Foundry-Client";

module.exports = {
  appId: "com.silvestrae.ve-foundry-client",
  productName: "VE Foundry Client",

  directories: {
    output: "dist",
    buildResources: "src/icons",
  },

  files: [
    // 1) main + preload:
    { from: ".vite/build", to: ".vite/build", filter: ["**/*"] },
    // 2) renderer → resources/renderer
    { from: ".vite/renderer", to: "renderer", filter: ["**/*"] },
    "node_modules/**/*",
    "package.json",
  ],

  extraMetadata: {
    main: ".vite/build/main.js",
  },

  win: {
    target: [
      { target: "nsis", arch: ["x64", "ia32"] },
      { target: "portable", arch: ["x64"] },
      "zip",
    ],
    icon: "src/icons/win/icon.ico",
    artifactName: `${artifactProductName}_\${version}_\${os}-\${arch}.\${ext}`,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    include: "build/installer.nsh",
    artifactName: `${artifactProductName}_\${version}_\${os}-\${arch}.\${ext}`,
  },
  portable: {
    artifactName: `${artifactProductName}_\${version}_portable-\${arch}.\${ext}`,
  },

  mac: {
    target: ["dmg", "zip"],
    icon: "src/icons/mac/icon.icns",
    artifactName: `${artifactProductName}_\${version}_\${os}-\${arch}.\${ext}`,
  },

  linux: {
    target: ["AppImage", "deb", "rpm", "zip", "tar.gz"],
    icon: "src/icons/png",
    maintainer: "JeidoUran <jeido.uran@hotmail.fr>",
    artifactName: `${artifactProductName}_\${version}_\${os}-\${arch}.\${ext}`,
  },

  publish: [
    {
      provider: "github",
      releaseType: "draft",
      vPrefixedTagName: "false",
    },
    // {
    //   provider: "s3",
    //   bucket: process.env.R2_BUCKET,
    //   endpoint: process.env.R2_ENDPOINT,
    // },
  ],
};
