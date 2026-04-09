const { execSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  if (process.platform === 'darwin' && context.electronPlatformName === 'darwin') {
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    try {
      console.log('  • stripping resource forks from', appPath);
      execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
    } catch (_) {
      // ignore if file doesn't exist (cross-platform builds)
    }
  }
};
