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

export interface ResolvedStream {
  url: string;
  quality: string;
  codec: string;
  mimeType: string;
}

const QUALITY_LADDER = ['HI_RES_LOSSLESS', 'HI_RES', 'LOSSLESS', 'HIGH', 'LOW'];

export class TidalWeb {
  constructor(private auth: TidalAuth) {}

  async getStreamUrl(trackId: string, quality: string = 'HIGH'): Promise<string> {
    const resolved = await this.resolveStream(trackId, quality);
    return resolved.url;
  }

  async resolveStream(trackId: string, requestedQuality: string = 'HIGH'): Promise<ResolvedStream> {
    const startIdx = QUALITY_LADDER.indexOf(requestedQuality.toUpperCase());
    const ladder = startIdx >= 0 ? QUALITY_LADDER.slice(startIdx) : ['HIGH', 'LOW'];
    let lastError = '';

    for (const quality of ladder) {
      try {
        const info = await this.getPlaybackInfo(trackId, quality);
        const manifest = this.decodeManifest(info.manifest, info.manifestMimeType);
        if (!manifest.urls.length) {
          lastError = `${quality}: empty urls`;
          continue;
        }
        if (manifest.encryptionType && manifest.encryptionType.toUpperCase() !== 'NONE') {
          lastError = `${quality}: encrypted`;
          continue;
        }
        return {
          url: manifest.urls[0],
          quality,
          codec: manifest.codecs,
          mimeType: manifest.mimeType,
        };
      } catch (err) {
        lastError = `${quality}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    throw new Error(`Не удалось получить поток: ${lastError}`);
  }

  async getPlaybackInfo(trackId: string, quality: string = 'HIGH'): Promise<PlaybackInfo> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      audioquality: quality,
      playbackmode: 'STREAM',
      assetpresentation: 'FULL',
      countryCode: cc,
    });

    const doFetch = async (token: string) => fetch(
      `${API_BASE}/tracks/${trackId}/playbackinfopostpaywall?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'TIDAL/2026.4.23 CFNetwork/1494.0.7 Darwin/23.4.0',
          'x-tidal-client-version': this.auth.getClientVersion(),
        },
      }
    );

    let token = await this.auth.getAccessToken();
    let res = await doFetch(token);
    if (res.status === 401) {
      token = await this.auth.getAccessToken({ force: true });
      res = await doFetch(token);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`playbackinfo ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json<PlaybackInfo>();
  }

  async getDownloadUrl(trackId: string, quality: string = 'LOSSLESS'): Promise<string> {
    return this.getStreamUrl(trackId, quality);
  }

  private decodeManifest(manifestB64: string, mimeType: string): BtsManifest {
    const decoded = atob(manifestB64);

    if (mimeType === 'application/vnd.tidal.bts') {
      return JSON.parse(decoded) as BtsManifest;
    }

    if (mimeType === 'application/dash+xml') {
      const baseUrlMatch = decoded.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/);
      if (baseUrlMatch) {
        return {
          urls: [baseUrlMatch[1].trim()],
          codecs: this.extractCodec(decoded),
          mimeType: 'audio/mp4',
          encryptionType: 'NONE',
        };
      }
      const initMatch = decoded.match(/initialization="([^"]+)"/);
      if (initMatch) {
        const initUrl = initMatch[1].replace(/\$RepresentationID\$/g, 'audio');
        return {
          urls: [initUrl],
          codecs: this.extractCodec(decoded),
          mimeType: 'audio/mp4',
          encryptionType: 'NONE',
        };
      }
    }

    throw new Error(`unsupported manifest mime: ${mimeType}`);
  }

  private extractCodec(dashXml: string): string {
    const m = dashXml.match(/codecs="([^"]+)"/);
    return m?.[1] ?? 'mp4a.40.2';
  }
}
