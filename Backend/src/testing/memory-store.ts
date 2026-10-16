import { Game } from '../entities/game.entity';
import { Player } from '../entities/player.entity';
import { Team } from '../entities/team.entity';
import { Champion } from '../entities/champion.entity';
import { Event } from '../entities/event.entity';
import { Takedown } from '../entities/takedown.entity';
import { Reward } from '../entities/reward.entity';
import { Punishment } from '../entities/punishment.entity';
import { ActivityLog } from '../entities/activity-log.entity';

/** Synthetic transaction-contract fixture. Real PostgreSQL is covered separately. */
export class MemoryStore {
  keys = new Map<any, string>([[Game, 'gameId'], [Player, 'playerId'], [Team, 'teamId'], [Champion, 'championId'],
    [Event, 'eventId'], [Takedown, 'takedownId'], [Reward, 'rewardId'], [Punishment, 'punishmentId'], [ActivityLog, 'activityId']]);
  rows = new Map<any, any[]>([...this.keys.keys()].map(type => [type, []]));
  tail = Promise.resolve();
  failOn: any;
  all(type: any): any[] { return this.rows.get(type); }
  async find(type: any) { return this.all(type); }
  async save(type: any, row: any) {
    if (this.failOn === type) { this.failOn = null; throw new Error('injected failure'); }
    const key = this.keys.get(type);
    if (!row[key]) row[key] = Math.max(0, ...this.all(type).map(item => item[key])) + 1;
    const index = this.all(type).findIndex(item => item[key] === row[key]);
    if (index < 0) this.all(type).push(row); else this.all(type)[index] = row;
    return row;
  }
}
