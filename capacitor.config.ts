import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.yesweigh.service',
  appName: 'YesWeigh Service',
  webDir: 'dist',
  server: {
    // Thin shell: APK loads the live PWA so hosting deploys update staff without a new APK.
    url: 'https://service.yesweigh.in',
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
    },
  },
};

export default config;
