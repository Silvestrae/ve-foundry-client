export interface AppConfigurationForm {
  cachePath: string;
  clearCacheOnClose: boolean;
  insecureSsl: boolean;
  notificationTimer: number;
  enableServerStatus: boolean;
  showServerStatusOnline: boolean;
  showFoundryVersion: boolean;
  showWorldName: boolean;
  showGameSystem: boolean;
  showGameVersion: boolean;
  showOnlinePlayers: boolean;
  serverInfosPingRate: number;
  forceFullScreen: boolean;
  shareSessionBetweenWindows: boolean;
  enableDiscordRp: boolean;
}
