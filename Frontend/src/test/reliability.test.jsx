import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import axios from 'axios';
import StatusPage from '../StatusPage/StatusPage';
import TeamSelectionPage from '../TeamSelectionPage/TeamSelectionPage';
import ChampionSelectionPage from '../ChampionSelectionPage/ChampionSelectionPage';
import ChampionCard from '../ChampionSelectionPage/ChampionCard';
import PunishmentDisplay from '../StatusPage/PunishmentDisplay';
import RewardDisplay from '../StatusPage/RewardDisplay';
import Linkbox from '../CreationPage/Linkbox';
import CreationForm from '../CreationPage/CreationForm';
import NameForm from '../FrontPage/NameForm';
import LoLApiFeed from '../LoLApi/LolApi';
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('axios', () => { const client = { get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } }; client.create = vi.fn(() => client); return { default: client }; });
const champion = { championId: 9, championName: 'Ahri', player: null, team: { teamId: 2, teamName: 0 } };
const status = { champion, team: { teamId: 2, teamName: 0 }, enemyTeamId: 8, gameState: 'live', feedStale: false, punishments: [], rewards: [], kda: [2,1,3], rotationRemainingSeconds: 180, rotationAvailable: false, enemyTeam: [] };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
beforeEach(() => { vi.clearAllMocks(); localStorage.setItem('baseURL','/api'); localStorage.setItem('GameID','5'); localStorage.setItem('playerId','42'); localStorage.setItem('playerName','Alex'); sessionStorage.setItem('bb:active', JSON.stringify({ gameId: 5, playerId: 42, playerName: 'Alex' })); sessionStorage.setItem('bb:player:5:42','player-secret'); axios.get.mockResolvedValue({ data: status }); axios.post.mockResolvedValue({ data: { ...status, playerId: 42, playerToken: 'player-secret' } }); });
test('status retries a failed poll, uses canonical champion and cleans interval', async () => {
  vi.useFakeTimers(); axios.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: status });
  const view = render(<StatusPage />); await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent(/retry|offline|failed/i);
  await act(async () => { vi.advanceTimersByTime(1100); });
  expect(screen.getByText('2/1/3')).toBeInTheDocument(); expect(navigate).not.toHaveBeenCalled();
  view.unmount(); const calls = axios.get.mock.calls.length; await act(async () => { vi.advanceTimersByTime(5000); }); expect(axios.get).toHaveBeenCalledTimes(calls);
});
test('status loading is not rotation zero and ended match does not redirect', async () => {
  const req=deferred(); axios.get.mockReturnValueOnce(req.promise); render(<StatusPage/>); expect(navigate).not.toHaveBeenCalled();
  await act(async () => req.resolve({data:{...status, gameState:'ended', rotationRemainingSeconds:0}}));
  expect(screen.getByRole('status')).toHaveTextContent(/game ended/i); expect(navigate).not.toHaveBeenCalled();
});
test('empty waiting teams render safely; duplicate name does not grant READY', async () => {
  axios.get.mockResolvedValue({data:{players:{blue:[],red:[]},teams:[]}}); const view=render(<TeamSelectionPage/>);
  await act(async()=>{}); expect(screen.getByRole('button',{name:'READY'})).toBeDisabled(); view.unmount();
  axios.get.mockResolvedValue({data:{players:{blue:[{playerId:43,playerName:'Alex'}],red:[]},teams:[{teamId:8,teamName:1},{teamId:2,teamName:0}]}});
  render(<TeamSelectionPage/>); await act(async()=>{}); expect(screen.getByRole('button',{name:'READY'})).toBeDisabled(); expect(screen.queryByText(/Alex \(you\)/)).not.toBeInTheDocument();
});
test('membership uses ID, resets when removed and team uses explicit name', async()=>{
  vi.useFakeTimers(); axios.get.mockResolvedValueOnce({data:{players:{blue:[{playerId:42,playerName:'Alex'}],red:[]},teams:[{teamId:8,teamName:1},{teamId:2,teamName:0}]}}).mockResolvedValue({data:{players:{blue:[],red:[]},teams:[{teamId:8,teamName:1},{teamId:2,teamName:0}]}});
  render(<TeamSelectionPage/>); await act(async()=>{}); expect(screen.getByRole('button',{name:'READY'})).toBeEnabled(); expect(screen.getByText('Team Blue').closest('.bg-cyan-500')).toHaveClass('bg-cyan-500');
  await act(async()=>vi.advanceTimersByTime(1100)); expect(screen.getByRole('button',{name:'READY'})).toBeDisabled();
});
test('champion pool uses explicit team ID not parity', async()=>{
  axios.get.mockImplementation((url)=>Promise.resolve({data: url.includes('getAllChampions') ? {blue:[champion],red:[{...champion,championId:10,championName:'Garen',team:{teamId:8,teamName:1}}]} : {...status, champion:null}}));
  localStorage.setItem('teamId','2'); render(<ChampionSelectionPage/>); await act(async()=>{}); expect(screen.getByRole('button',{name:'Ahri'})).toBeInTheDocument(); expect(screen.queryByRole('button',{name:'Garen'})).not.toBeInTheDocument();
});
test('champion selection awaits commit, blocks duplicate clicks and recovers conflict', async()=>{
  const req=deferred(); axios.post.mockReturnValueOnce(req.promise); render(<ChampionCard champion={champion}/>); const button=screen.getByRole('button'); fireEvent.click(button); fireEvent.click(button); expect(axios.post).toHaveBeenCalledTimes(1); expect(navigate).not.toHaveBeenCalled();
  await act(async()=>req.reject({response:{status:409},message:'Already selected'})); expect(screen.getByRole('alert')).toHaveTextContent(/selected|available|conflict/i); expect(button).toBeEnabled(); expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(button); await act(async()=>{}); expect(axios.post.mock.calls[1][1]).toEqual({player:42,champion:9}); expect(navigate).toHaveBeenCalledWith('/status');
});
test('punishments safely show environmental kills and missing distributor',()=>{
  const view=render(<PunishmentDisplay punishmentStack={[{punishmentId:1,punishmentType:1,amount:7,takedown:{killer:null}}]}/>); expect(screen.getByText(/Drink 7/)).toBeInTheDocument();
  view.rerender(<PunishmentDisplay punishmentStack={[{punishmentId:2,punishmentType:2,amount:8,distributor:null}]}/>); expect(screen.getByText(/Drink 8/)).toBeInTheDocument();
});
test('all reward targets locked until mutation AND canonical refresh finish',async()=>{
  const req=deferred(), refresh=deferred(); axios.post.mockReturnValue(req.promise); const onRefresh=vi.fn(()=>refresh.promise);
  render(<RewardDisplay rewardStack={[{rewardId:7,amount:9}]} enemyTeam={[{...champion,player:{playerId:50,playerName:'One'}},{...champion,championId:10,player:{playerId:51,playerName:'Two'}}]} onRefresh={onRefresh}/>);
  fireEvent.click(screen.getByRole('button',{name:/One/})); expect(screen.getByRole('button',{name:/Two/})).toBeDisabled(); expect(axios.post.mock.calls[0][1]).toEqual({id:7,punishment:{recipient:{playerId:50}}});
  await act(async()=>req.resolve({data:{}})); expect(onRefresh).toHaveBeenCalled(); expect(screen.getByRole('button',{name:/Two/})).toBeDisabled(); await act(async()=>refresh.resolve());
});
test('invite derives origin path without query, hash or host secret',()=>{
  window.history.replaceState({},'', '/?secret=value#hash'); render(<Linkbox gameCode="KFRW"/>); expect(screen.getByText(`${window.location.origin}/name/KFRW`)).toBeInTheDocument();
});
test('creation rejects HTML success responses visibly and re-enables submit',async()=>{
  axios.get.mockResolvedValue({data:'<!doctype html>'}); render(<CreationForm setGame={vi.fn()}/>);
  screen.getAllByRole('textbox').forEach(input=>fireEvent.change(input,{target:{value:'3'}})); fireEvent.click(screen.getByRole('button',{name:'CREATE'})); await act(async()=>{}); expect(screen.getByRole('alert')).toHaveTextContent(/invalid|response/i); expect(screen.getByRole('button',{name:'CREATE'})).toBeEnabled();
});
test('name submit failure resets pending and keeps session token out of localStorage',async()=>{
  axios.get.mockResolvedValueOnce({data:{gameId:5,gameCode:'KFRW'}}); axios.post.mockRejectedValueOnce(new Error('offline')); render(<NameForm gameCode="KFRW"/>); fireEvent.change(screen.getByLabelText('What is your name?'),{target:{value:'Alex'}}); fireEvent.click(screen.getByRole('button',{name:'START'})); await act(async()=>{}); expect(screen.getByRole('alert')).toHaveTextContent(/offline|failed/i); expect(screen.getByRole('button',{name:'START'})).toBeEnabled();
});
test('monitor describes the automatic feed without asking for tokens or pairing',async()=>{
   window.history.replaceState({},'', '/lolApi'); render(<LoLApiFeed/>); await act(async()=>{}); expect(screen.getByText(/verbinde den Companion/)).toBeInTheDocument(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(axios.post).not.toHaveBeenCalled();
});
