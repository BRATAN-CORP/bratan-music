import { TidalAuth } from './TidalAuth';

const API_BASE = 'https://api.tidal.com/v1';

interface PlaybackInfo {
  trackId: number;
  audioMode: string;
  audioQuality: string;
  manifestMimeType: string;
  manifest: string;
}

interface BtsManifest {
  urls: string[];
  codecs: string;
  mimeType: string;
  encryptionType: string;
}

export class TidalWeb {
  constructor(private auth: TidalAuth) {}

  async getStreamUrl(trackId: string, quality: string = 'HIGH'): Promise<string> {
    const playbackInfo = await this.getPlaybackInfo(trackId, quality);
    const manifest = this.decodeManifest(playbackInfo.manifest, playbackInfo.manifestMimeType);

    if (!manifest.urls.length) {
      throw new Error('Нет доступных URL для воспроизведения');
    }

    return manifest.urls[0];
  }

  async getPlaybackInfo(trackId: string, quality: string = 'HIGH'): Promise<PlaybackInfo> {
    const token = await this.auth.getAccessToken();
    const cc = await this.auth.getCountryCode();

    const params = new URLSearchParams({
      audioquality: quality,
      playbackmode: 'STREAM',
      assetpresentation: 'FULL',
      countryCode: cc,
    });

    const res = await fetch(`${API_BASE}/tracks/${trackId}/playbackinfopostpaywall?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tidal playback info ${res.status}: ${text}`);
    }

    return res.json<PlaybackInfo>();
  }

  async getDownloadUrl(trackId: string, quality: string = 'LOSSLESS'): Promise<string> {
    return this.getStreamUrl(trackId, quality);
  }

  private decodeManifest(manifestB64: string, mimeType: string): BtsManifest {
    if (mimeType === 'application/vnd.tidal.bts') {
      const decoded = atob(manifestB64);
      return JSON.parse(decoded) as BtsManifest;
    }

    if (mimeType === 'application/dash+xml') {
      const decoded = atob(manifestB64);
      const urlMatch = decoded.match(/BaseURL>(https?:\/\/[^<]+)<\/BaseURL/);
      if (urlMatch) {
        return {
          urls: [urlMatch[1]],
          codecs: 'flac',
          mimeType: 'audio/flac',
          encryptionType: 'NONE',
        };
      }
    }

    throw new Error(`Неизвестный тип манифеста: ${mimeType}`);
  }
}
