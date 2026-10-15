import { Injectable } from '@nestjs/common';
import axios from 'axios';
import https from 'https';
import { AllGameDataResponse } from './lolAPItypes';

/**
 * Optional local League client adapter. It only fetches a snapshot; persistence
 * and event processing belong to the authenticated game-scoped feed endpoint.
 */
@Injectable()
export class LolAPIService {
  BASE_URL = 'https://127.0.0.1:2999';
  ALL_GAME_DATA_ENDPOINT = '/liveclientdata/allgamedata';

  async getLolInput(): Promise<AllGameDataResponse> {
    const allGameDataUrl = this.BASE_URL + this.ALL_GAME_DATA_ENDPOINT;
    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }), // Ignore SSL certificate errors.
    });
    const response = await axiosInstance.get(allGameDataUrl);
    return response.data as AllGameDataResponse;
  }
}
