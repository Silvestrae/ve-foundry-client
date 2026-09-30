# Linux Packaging

AppImage artifacts use `VE-Foundry-Client_<version>_<arch>.AppImage`. The architecture remains explicit (`x86_64` or `arm64`), so downloads cannot be confused between supported architectures. Other Linux package filenames retain the `linux` label.

The built-in updater uses `electron-updater`, the generated `latest-linux*.yml` manifests, and the embedded blockmap. It selects AppImage assets by extension rather than a fixed filename. The AppImage-only filename override therefore preserves the existing update mechanism.

## Deferred AppImage Catalog Feedback

These items need additional Linux packaging and launch validation before inclusion in a release:

- **Static runtime:** electron-builder 26.15.6 defaults to its legacy FUSE2 runtime. The supported opt-in `toolsets.appimage: "1.0.3"` uses a static runtime and removes the runtime's host `libfuse2` dependency. It also changes default launch arguments and compression. Test both supported architectures, normal launches, hosts with restricted user namespaces, and updates from the previous AppImage before switching. A static runtime does not remove Electron's system library requirements or make every Linux distribution compatible.
- **External AppImageUpdate support:** the current builder does not expose AppImage update information or generate `.zsync` files. Adding these requires custom packaging steps. Embed architecture-specific `gh-releases-zsync` information before the Electron updater blockmap and checksums are finalized, then generate `.zsync` files from the final artifacts and upload them beside the AppImages. Verify both external AppImageUpdate and built-in updates; changing an AppImage after its updater metadata is generated invalidates that metadata.
- **AppStream metadata:** add and validate application metadata in the AppImage's `usr/share/metainfo` directory before claiming catalog support. Check its component ID, desktop launcher ID, license, links, and installed location in the built artifact.

The Node 20/24 warnings in the AppImage catalog's checks belong to that repository's GitHub Actions configuration.

## Next Release Checks

- Build x86_64 and arm64 AppImages and confirm the filenames have no redundant `linux` label.
- Confirm each generated `latest-linux*.yml` manifest points to its matching renamed AppImage and checksum.
- Check that the desktop launcher's comment describes the app rather than repeating its name.
- Smoke-test the packaged launcher on Linux and update an installed previous-version AppImage using the built-in updater.

## References

- [AppImage catalog test report](https://github.com/AppImage/appimage.github.io/pull/9174#issuecomment-5903693254)
- [electron-builder v26 AppImage configuration](https://www.electron.build/v26/docs/appimage/)
- [AppImage update information and zsync](https://docs.appimage.org/packaging-guide/optional/updates.html)
