import { Injectable } from '@nestjs/common';
import axios from 'axios';
import https from 'https';
import { AllGameDataResponse } from './lolAPItypes';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { writeFile } from 'fs/promises';

@Injectable()
export class LolAPIService {
  BASE_URL = 'https://127.0.0.1:2999';
  ALL_GAME_DATA_ENDPOINT = '/liveclientdata/allgamedata';
  LOL_INPUT_PATH = path.join(process.cwd(), 'lolInput.json');

  async getLolInput() {
    const allGameDataUrl = this.BASE_URL + this.ALL_GAME_DATA_ENDPOINT;
    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }), // Ignore SSL certificate errors
    });
    const response = await axiosInstance.get(allGameDataUrl);
    const responseData = response.data as AllGameDataResponse;
    return responseData;
  }

  async saveLolInput(input: AllGameDataResponse) {
    try {
      await writeFile(this.LOL_INPUT_PATH, JSON.stringify(input, null, 2));
      console.log('Game data successfully saved to', this.LOL_INPUT_PATH);
    } catch (err) {
      console.error('Failed to save game data:', err);
      throw err; // Re-throw if you want calling code to handle the error
    }
  }

  async readLolInput(): Promise<AllGameDataResponse> {
    const maxAttempts = 3;
    let attemptCounter = 0;
    let data;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const fileContent = readFileSync(this.LOL_INPUT_PATH, 'utf-8');
        data = JSON.parse(fileContent) as AllGameDataResponse;
        break;
      } catch (error) {
        console.error(
          `Error reading/parsing data on attempt ${attemptCounter + 1}:`,
          error.message
        );
        attemptCounter++;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    return data;
  }
}
