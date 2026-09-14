Webfox fixes Nix installations after version-only releases. The dependency cache now stays valid when the release process updates package versions.

## 🐞 Bug fixes

### Keep Nix packages buildable across releases

Nix installations now keep working after a Webfox release changes the package version. Version-only releases no longer invalidate the pinned dependency cache.

*By @mavam.*
