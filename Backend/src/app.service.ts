import { Injectable } from '@nestjs/common';
import { AllPlayer, Event as LolEvent } from './lolAPItypes';
import { Game } from './entities/game.entity';
import { LolAPIService } from './lolAPI.service';
import { ChampionService } from './champion.service';
import { GameService } from './game.service';
import { TeamService } from './team.service';
import { TakedownService } from './takedown.service';
import { EventService } from './event.service';
import { PunishmentService } from './punishment.service';
import { PlayerService } from './player.service';
import { RewardService } from './reward.service';

@Injectable()
export class AppService {
  constructor(
    private lolApiService: LolAPIService,
    private championService: ChampionService,
    private gameService: GameService,
    private teamService: TeamService,
    private takedownService: TakedownService,
    private eventService: EventService,
    private punishmentService: PunishmentService,
    private playerService: PlayerService,
    private rewardService: RewardService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async runGame(gameID) {
    let gameEnded = false;
    let input = await this.lolApiService.readLolInput();
    const game = await this.setUpTeams(input.allPlayers, gameID);

    while (!gameEnded) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const priorInput = input;
      input = await this.lolApiService.readLolInput();

      const newEvents = this.filterNewEvents(
        input.events.Events,
        priorInput.events.Events,
      );

      this.saveEvents(newEvents, game);

      gameEnded = await this.eventService.hasGameEnded(game);
    }
  }

  async setUpTeams(champions: AllPlayer[], gameId) {
    let game = await this.gameService.getGame(gameId);
    const teamOrder = await this.teamService.createTeam(0, game);
    const teamChaos = await this.teamService.createTeam(1, game);
    game.teams = [teamOrder, teamChaos];
    for (const champ of champions) {
      let championTeam;
      if (champ.team === 'ORDER') {
        championTeam = teamOrder;
      } else {
        championTeam = teamChaos;
      }
      const championTemplate = {
        championName: champ.championName,
        summonerName: champ.riotIdGameName,
        team: championTeam,
      };
      const createdChampion =
        await this.championService.createChampion(championTemplate);
      // if (createdChampion.team === game.teams[0]) {
      //   game.teams[0].champions.push(createdChampion);
      // } else {
      //   game.teams[1].champions.push(createdChampio);
      // }
    }
    game = await this.setupPlayerRoster(game); //to-do
    return game;
  }

  async saveEvents(newEventData: LolEvent[], activeGame: Game) {
    for (const event of newEventData) {
      const eventTemplate = {
        ingameId: event.EventID,
        eventType: event.EventName,
        game: activeGame,
      };

      const createdEvent = await this.eventService.createEvent(eventTemplate);
      if (createdEvent.eventType === 'ChampionKill') {
        const takedownTemplate = {
          multiKill: 1,
          event: createdEvent,
          shutdown: false,
          killer: await this.championService.getChampion(
            event.KillerName,
            activeGame,
          ),
          killed: await this.championService.getChampion(
            event.VictimName,
            activeGame,
          ),
        };

        const createdTakedown =
          await this.takedownService.createTakedown(takedownTemplate);
        const punishmentTemplate = {
          takedown: createdTakedown,
          punishmentType: 1,
          amount: 3,
          player: await this.playerService.getChampionPlayer(
            takedownTemplate.killed.championId,
          ),
        };

        await this.punishmentService.createPunishment(punishmentTemplate);
        const rewardTemplate = {
          takedown: createdTakedown,
          rewardType: 1,
          amount: 3,
          player: await this.playerService.getChampionPlayer(
            takedownTemplate.killer.championId,
          ),
        };
        await this.rewardService.createReward(rewardTemplate);
      }
    }
  }

  setupPlayerRoster(game: Game): Game {
    //this will get a list of players with their names and teams after they have been selcted in the App
    return game;
  }

  filterNewEvents(inputNew: LolEvent[], inputOld: LolEvent[]) {
    return inputNew.filter(
      (item) => !inputOld.map((ev) => ev.EventID).includes(item.EventID),
    );
  }
}
