"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ManagerAccounts from "./manager-accounts";
import PairingEditor from "./pairing-editor";
import PlayerImports from "./player-imports";
import TournamentNameInput from "./tournament-name-input";
import PairingsTable from "./pairings-table";
import TournamentStandings from "./tournament-standings";
import { resultLocked } from "@/lib/round-editing";
import { priorSeriesSessions, sessionGroups } from "@/lib/series";
import {csvCell as csv} from '@/lib/csv';
import type {SheetSyncStatus} from '@/lib/sheets-sync';
import {
  applyAction,
  calculateStats,
  demoClub,
  pairRound,
  weeklyStandings,
  type Action,
  type Club,
  type Round,
} from "@/lib/chess";
type Snapshot = {
  club: Club;
  version: number;
  user: { name: string; role: string };
  error?: string;
  sheetSync?: SheetSyncStatus;
};
function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const today = () => new Date().toLocaleDateString("en-CA");
export default function Boardroom() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [demo, setDemo] = useState(false),
    [tab, setTab] = useState("session"),
    [displayOnly, setDisplayOnly] = useState(false),
    [sessionId, setSessionId] = useState(""),
    [roundNo, setRoundNo] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false),
    [deleting, setDeleting] = useState<{id:string;name:string;version:number}|null>(null),
    [ratingEdit, setRatingEdit] = useState<{id:string;value:string;version:number}|null>(null),
    [nameEdit, setNameEdit] = useState<{id:string;value:string;version:number}|null>(null),
    [cancelling, setCancelling] = useState<{id:string;version:number}|null>(null),
    [editing, setEditing] = useState<{
      version: number;
      sessionId: string;
      round: number;
    } | null>(null),
    [draft, setDraft] = useState<{ round: Round; version: number } | null>(
      null,
    ),
    [rematches, setRematches] = useState(false),
    [byePlayer, setByePlayer] = useState(""),
    [creating, setCreating] = useState(false),
    [sessionMode, setSessionMode] = useState<'weekly'|'tournament'>('weekly'),
    [date, setDate] = useState(today),
    [name, setName] = useState("Weekly tournament"),
    [time, setTime] = useState("10 min"),
    [rounds, setRounds] = useState(2),
    [search, setSearch] = useState(""),
    [finishing, setFinishing] = useState(false);
  const latest = useRef<Snapshot | null>(null),
    busy = useRef(false),
    deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = deleteDialog.current;
    if (deleting && dialog && !dialog.open) dialog.showModal();
    if (!deleting && dialog?.open) dialog.close();
  }, [deleting]);
  const accept = useCallback((s: Snapshot) => {
    if (latest.current && s.version < latest.current.version) return;
    latest.current = s;
    setSnapshot(s);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/club", { cache: "no-store" });
      if (r.status === 401) {
        location.reload();
        return;
      }
      const d = (await r.json()) as Snapshot;
      if (!r.ok) throw new Error(d.error ?? "Could not load club.");
      accept(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load club.");
    }
  }, [accept]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("demo") === "1") {
      setDemo(true);
      accept({
        club: demoClub(),
        version: 1,
        user: { name: "Demo", role: "owner" },
      });
      return;
    }
    void refresh();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && !busy.current)
        void refresh();
    }, 8000);
    const focus = () => {
      if (!busy.current) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", focus);
    };
  }, [accept, refresh]);
  useEffect(() => {
    if (draft && draft.version !== snapshot?.version) setDraft(null);
  }, [snapshot?.version, draft]);
  useEffect(() => {
    if (editing && editing.version !== snapshot?.version) setEditing(null);
  }, [editing, snapshot?.version]);
  const club = snapshot?.club,
    event =
      club?.tournaments.find((t) => t.id === sessionId) ??
      club?.tournaments.find((t) => t.status !== "completed") ??
      club?.tournaments.at(-1);
  const stats = useMemo(() => (club ? calculateStats(club) : {}), [club]),
    standings = useMemo(
      () => (club && event ? weeklyStandings(club, event) : []),
      [club, event],
    );
  const people = useMemo(
    () => Object.fromEntries([
      ...(club?.deletedPlayers ?? []).map((p) => [p.id, "Deleted player"]),
      ...(club?.players ?? []).map((p) => [p.id, p.name]),
    ]),
    [club],
  );
  const groups=useMemo(()=>club?sessionGroups(club):[],[club]);
  const mutate = async (action: Action, expectedVersion?: number) => {
    if (busy.current || !latest.current) return false;
    if (
      expectedVersion !== undefined &&
      expectedVersion !== latest.current.version
    ) {
      setEditing(null);
      setError("Another manager changed the club. Review the latest data and try again.");
      return false;
    }
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      if (demo) {
        accept({
          ...latest.current,
          club: applyAction(latest.current.club, action, {
            id: "demo",
            email: "demo@local.test",
            role: "owner",
          }),
          version: latest.current.version + 1,
        });
      } else {
        const r = await fetch("/api/club", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: expectedVersion ?? latest.current.version,
            action,
          }),
        });
        const d = (await r.json()) as Snapshot;
        if (!r.ok) {
          if (r.status === 409) {
            setDraft(null);
            await refresh();
          }
          if (r.status === 401) location.reload();
          throw new Error(d.error ?? "Could not save.");
        }
        accept(d);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const generate = () => {
    if (!club || !event) return;
    setError("");
    try {
      setDraft({
        round: pairRound(club, event, rematches),
        version: snapshot!.version,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pair.");
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied.");
    } catch {
      download("names.txt", value);
      setNotice("Downloaded.");
    }
  };
  if (!club)
    return (
      <main className="tool">
        <h1>AYJ Chess</h1>
        <p role={error ? "alert" : "status"}>{error || "Loading…"}</p>
        {error && <button onClick={() => void refresh()}>Retry</button>}
      </main>
    );
  const owner = snapshot!.user.role === "owner",
    canDelete = owner || snapshot!.user.role === "manager",
    currentRound =
      event?.rounds.find((r) => r.number === roundNo) ?? event?.rounds.at(-1),
    displayRound = draft?.round ?? currentRound,
    active = event && event.status !== "completed",
    complete =
      event?.rounds.length &&
      event.rounds.every(
        (r) => !r.unpaired?.length && r.games.every((g) => g.result),
      );
  const exportRatings = () =>
    download(
      "ratings.csv",
      [
        ["Name", "Elo", "Games", "Wins", "Draws", "Losses", "Points"],
        ...club.players.map((p) => [
          p.name,
          stats[p.id].rating,
          stats[p.id].games,
          stats[p.id].wins,
          stats[p.id].draws,
          stats[p.id].losses,
          stats[p.id].points,
        ]),
      ]
        .map((r) => r.map(csv).join(","))
        .join("\r\n"),
      "text/csv",
    );
  if (displayOnly && event && currentRound)
    return (
      <main className="pairing-display">
        <header>
          <h1>
            {event.name} · Round {currentRound.number}
          </h1>
          <button onClick={() => setDisplayOnly(false)}>Back</button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <PairingsTable
          round={currentRound}
          names={people}
          deletedPlayerIds={club.deletedPlayers?.map((p) => p.id)}
          display
          pending={pending}
          editable={!!active && currentRound.number === event.rounds.length}
          onResult={(gameId, result) =>
            void mutate({
              type: "result",
              tournamentId: event.id,
              round: currentRound.number,
              gameId,
              result,
            })
          }
        />
        {!!currentRound.unpaired?.length && (
          <p className="waiting">
            Waiting: {currentRound.unpaired.map((id) => people[id]).join(", ")}
          </p>
        )}
      </main>
    );
  return (
    <main className="tool">
      <header>
        <h1>AYJ Chess</h1>
        <div className="actions">
          <a href="/" target="_blank" rel="noopener noreferrer">Public view</a>
          <span>
            {snapshot!.user.name}
            {demo ? " · Demo" : ""}
          </span>
          <button
            onClick={async () => {
              if (demo) {
                location.href = "/";
                return;
              }
              await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <nav aria-label="Main">
        {["session", "ratings", "accounts", ...(owner ? ["logs"] : [])].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => {
              setTab(t);
              setError("");
              setNotice("");
            }}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <dialog ref={deleteDialog} className="delete-dialog"
        aria-labelledby="delete-player-title" aria-describedby="delete-player-description"
        onCancel={(e) => {e.preventDefault();if(!pending)setDeleting(null);}}>
        <h2 id="delete-player-title">Delete {deleting?.name}?</h2>
        <p id="delete-player-description">
          Their profile and unplayed pairings will be permanently removed.
          Recorded games stay as Deleted player. Other ratings stay unchanged.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button autoFocus disabled={pending} onClick={() => setDeleting(null)}>Cancel</button>
          <button className="danger" disabled={pending}
            onClick={async () => {
              if (deleting && await mutate({type:"deletePlayer",playerId:deleting.id,confirm:true},deleting.version))
                setDeleting(null);
            }}>Delete player</button>
        </div>
      </dialog>
      {tab === "session" && (
        <>
          <div className="toolbar">
            <button
              disabled={
                pending ||
                club.tournaments.some((t) => t.status !== "completed")
              }
              onClick={() => {
                if(!creating&&event)setName(event.name);
                setCreating(!creating);
              }}
            >
              New session
            </button>
            <label>
              Session
              <select
                value={event?.id ?? ""}
                onChange={(e) => {
                  setSessionId(e.target.value);
                  setDraft(null);
                  setEditing(null);
                  setRoundNo(0);
                  setFinishing(false);
                  setCancelling(null);
                }}
              >
                {groups.map(group=>(
                  <optgroup key={group.key} label={group.name+(group.sessions[0].mode==='tournament'?' · Tournament':'')}>
                  {group.sessions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.date} · {t.name}
                    {t.mode==='tournament'?' · Swiss':''}
                    {t.status === "completed" ? " · Completed" : ""}
                  </option>
                  ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          {(creating || !club.tournaments.length) && (
            <form
              className="panel fields"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                if (
                  await mutate({
                    type: "createSession",
                    name,
                    date,
                    timeControl: time,
                    maxRounds: rounds,
                    mode:sessionMode,
                    kFactor: Number(form.get("k")),
                  })
                ) {
                  setCreating(false);
                  setSessionId("");
                  setRoundNo(0);
                }
              }}
            >
              <h2>New session</h2>
              <div className="session-mode-field">
                <div className="session-mode-switch" role="group" aria-label="Session type">
                  <span className={sessionMode==='weekly'?'selected':''}>Weekly</span>
                  <button type="button" role="switch" aria-label="Tournament mode" aria-checked={sessionMode==='tournament'} disabled={pending}
                    onClick={()=>{
                      const next=sessionMode==='weekly'?'tournament':'weekly';setSessionMode(next);
                      setRounds(next==='tournament'?5:2);setTime(next==='tournament'?'25 + 5':'10 min');
                    }}><span /></button>
                  <span className={sessionMode==='tournament'?'selected':''}>Tournament</span>
                </div>
                {sessionMode==='tournament'&&<small>Swiss · automatic tie-breaks</small>}
              </div>
              <TournamentNameInput value={name} onChange={setName}
                names={sessionMode==='weekly'?groups.filter(group=>group.sessions[0].mode!=='tournament').map(group=>group.name):[]} disabled={pending}/>
              <label>
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Rounds
                <input
                  type="number"
                  min="1"
                  max={sessionMode==='tournament'?15:10}
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                  required
                />
              </label>
              <label>
                Time control
                <input
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  maxLength={40}
                />
              </label>
              <label htmlFor="session-k">
                <span className="field-label">
                  K factor
                  <span className="field-help">
                    <button type="button" className="help-trigger"
                      aria-label="About K factor" aria-describedby="k-help">?</button>
                    <span id="k-help" role="tooltip" className="help-tooltip">
                      K controls how much ratings change after a game. Higher K means larger changes. Default: 32.
                    </span>
                  </span>
                </span>
                <input id="session-k" name="k" aria-label="K factor"
                  type="number" min="8" max="64" step="1" required
                  defaultValue={club.kFactor} key={club.kFactor}
                  readOnly={!owner} disabled={pending} />
              </label>
              <div className="actions">
                <button className="primary" disabled={pending}>
                  Create
                </button>
                {club.tournaments.length > 0 && (
                  <button type="button" onClick={() => setCreating(false)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
          {event && (
            <>
              <div className="session-summary">
                <strong>{event.date}</strong>
                <span>{event.timeControl}</span>
                <span>
                  {event.roster.length - event.withdrawn.length} players
                </span>
                <span>
                  {event.rounds.length}/{event.maxRounds} rounds
                  {event.mode==='tournament'?' · Swiss tournament':''}
                </span>
                <span>{event.status === "completed" ? "Completed" : ""}</span>
                {owner&&<label className="public-toggle"><input type="checkbox" checked={event.publicVisible===true} disabled={pending||demo}
                  onChange={async e=>{await mutate({type:'setPublicView',tournamentId:event.id,enabled:e.target.checked});}}/>Show publicly</label>}
                {active && !event.rounds.length && (
                  cancelling?.id === event.id ? (
                    <div className="actions" role="group" aria-label="Cancel session confirmation">
                      <span>Cancel this session?</span>
                      <button className="danger" disabled={pending}
                        onClick={async () => {
                          const saved = await mutate({type:"cancelSession",tournamentId:event.id,confirm:true},cancelling.version);
                          setCancelling(null);
                          if (saved) {
                            setDraft(null);setEditing(null);setSessionId("");setRoundNo(0);setCreating(false);setFinishing(false);
                            setNotice("Session cancelled.");
                          }
                        }}>Confirm cancel</button>
                      <button autoFocus disabled={pending} onClick={() => setCancelling(null)}>Keep session</button>
                    </div>
                  ) : (
                    <button className="danger" disabled={pending}
                      onClick={() => setCancelling({id:event.id,version:snapshot!.version})}>Cancel session</button>
                  )
                )}
              </div>
              <div className="columns">
                <section className="panel roster">
                  <h2>Players</h2>
                  {active && (
                    <PlayerImports
                      key={event.id}
                      club={club}
                      pending={pending}
                      onImport={async (text, mode,initialRatings) => {
                        const saved = await mutate({
                          type: "importNames",
                          tournamentId: event.id,
                          text,
                          mode,
                          initialRatings,
                        });
                        if (saved) {
                          setDraft(null);
                          setEditing(null);
                          if(event.rounds.length)setRoundNo(event.rounds.length);
                          setNotice(event.rounds.length ? "Players added. Pair waiting players when ready." : "Players added.");
                        }
                        return saved;
                      }}
                    />
                  )}
                  <div className="actions">
                    <button
                      disabled={!event.roster.length}
                      onClick={() =>
                        void copy(
                          event.roster
                            .filter((id) => !event.withdrawn.includes(id))
                            .map((id) => people[id])
                            .join("\n"),
                        )
                      }
                    >
                      Copy names
                    </button>
                  </div>
                  <ul className="roster-list">
                    {[...club.players]
                      .filter(
                        (p) =>
                          event.roster.includes(p.id) ||
                          (!event.rounds.length && !p.archived),
                      )
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((p) => (
                        <li key={p.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={
                                event.roster.includes(p.id) &&
                                !event.withdrawn.includes(p.id)
                              }
                              disabled={pending || !active || !!editing}
                              onChange={(e) =>
                                void mutate({
                                  type: "attendance",
                                  tournamentId: event.id,
                                  playerId: p.id,
                                  present: e.target.checked,
                                })
                              }
                            />
                            <span>{p.name}</span>
                            {event.rounds.at(-1)?.eligiblePlayers && !event.rounds.at(-1)!.eligiblePlayers!.includes(p.id) && (
                              <small>Round {event.rounds.length + 1}</small>
                            )}
                            <small>{stats[p.id].rating}</small>
                          </label>
                        </li>
                      ))}
                  </ul>
                </section>
                <section className="panel pairings">
                  <div className="section-heading">
                    <h2>Pairings & results</h2>
                    {event.rounds.length > 0 && (
                      <label>
                        Round
                        <select
                          aria-label="View round"
                          value={currentRound?.number ?? 0}
                          onChange={(e) => {
                            setRoundNo(Number(e.target.value));
                            setDraft(null);
                            setEditing(null);
                          }}
                        >
                          {event.rounds.map((r) => (
                            <option value={r.number} key={r.number}>
                              {r.number}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="actions">
                    {currentRound && !draft && !editing && (
                      <button
                        disabled={pending || !currentRound.games.length}
                        onClick={() => {
                          setSessionId(event.id);
                          setDisplayOnly(true);
                        }}
                      >
                        Display pairings
                      </button>
                    )}
                    {active &&
                      event.rounds.length < event.maxRounds &&
                      !draft &&
                      !editing && (
                        <button
                          className="primary"
                          disabled={
                            pending ||
                            !!event.rounds.some(
                              (r) =>
                                r.unpaired?.length ||
                                r.games.some((g) => !g.result),
                            )
                          }
                          onClick={generate}
                        >
                          Pair round {event.rounds.length + 1}
                        </button>
                      )}
                    {draft && (
                      <>
                        <button
                          className="primary"
                          disabled={pending}
                          onClick={async () => {
                            if (
                              await mutate({
                                type: "publishRound",
                                tournamentId: event.id,
                                allowRematches: rematches,
                              })
                            ) {
                              setDraft(null);
                              setRoundNo(0);
                            }
                          }}
                        >
                          Publish round {draft.round.number}
                        </button>
                        <button onClick={() => setDraft(null)}>Cancel</button>
                      </>
                    )}
                    {active &&
                      !draft &&
                      !editing &&
                      currentRound?.number === event.rounds.length && (
                        <>
                          <button
                            disabled={
                              pending ||
                              (!currentRound.games.some(
                                (g) => !resultLocked(g),
                              ) &&
                                !currentRound.unpaired?.length)
                            }
                            onClick={() =>
                              setEditing({
                                version: snapshot!.version,
                                sessionId: event.id,
                                round: currentRound.number,
                              })
                            }
                          >
                            Edit pairings
                          </button>
                          {!!currentRound.unpaired?.length && (
                            <button
                              className="primary"
                              disabled={pending || currentRound.unpaired.length < 2}
                              onClick={() =>
                                void mutate({
                                  type: "pairWaiting",
                                  tournamentId: event.id,
                                  round: currentRound.number,
                                  allowRematches: rematches,
                                })
                              }
                            >
                              Pair waiting players
                            </button>
                          )}
                        </>
                      )}
                    {active &&
                      !editing &&
                      (event.rounds.length < event.maxRounds ||
                        !!currentRound?.unpaired?.length) && (
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={rematches}
                            disabled={!!draft}
                            onChange={(e) => setRematches(e.target.checked)}
                          />
                          Allow rematches
                        </label>
                      )}
                  </div>
                  {draft?.round.warnings
                    .filter(
                      (w) =>
                        !/^Board \d+ pairs different score groups\.$/.test(w) &&
                        !w.endsWith(" have different scores."),
                    )
                    .map((w, i) => (
                      <p className="warning" key={i}>
                        {w}
                      </p>
                    ))}
                  {!editing && !!currentRound?.unpaired?.length && (
                    <p className="waiting" role="status">
                      Waiting:{" "}
                      {currentRound.unpaired.map((id) => people[id]).join(", ")}
                    </p>
                  )}
                  {active && !draft && !editing &&
                    currentRound?.number === event.rounds.length &&
                    !!currentRound.unpaired?.length && (
                      <div className="actions">
                        <select
                          aria-label="Player to receive bye"
                          value={currentRound.unpaired.includes(byePlayer)
                            ? byePlayer : currentRound.unpaired[0]}
                          disabled={pending}
                          onChange={(e) => setByePlayer(e.target.value)}
                        >
                          {currentRound.unpaired.map((id) => (
                            <option key={id} value={id}>{people[id]}</option>
                          ))}
                        </select>
                        <button
                          disabled={pending || currentRound.games.some((g) => !g.black)}
                          onClick={() => void mutate({
                            type: "assignBye",
                            tournamentId: event.id,
                            round: currentRound.number,
                            playerId: currentRound.unpaired!.includes(byePlayer)
                              ? byePlayer : currentRound.unpaired![0],
                          }, snapshot!.version)}
                        >
                          Assign bye
                        </button>
                        {currentRound.games.some((g) => !g.black) &&
                          <small>This round already has a bye.</small>}
                      </div>
                    )}
                  {editing &&
                  currentRound &&
                  editing.sessionId === event.id &&
                  editing.round === currentRound.number ? (
                    <PairingEditor
                      key={`${event.id}-${currentRound.number}-${editing.version}`}
                      event={event}
                      previousSessions={priorSeriesSessions(club,event)}
                      round={currentRound}
                      names={people}
                      pending={pending}
                      onCancel={() => setEditing(null)}
                      onSave={async (pairings, allowRematches) => {
                        if (
                          await mutate(
                            {
                              type: "editPairings",
                              tournamentId: event.id,
                              round: currentRound.number,
                              pairings,
                              allowRematches,
                            },
                            editing.version,
                          )
                        ) {
                          setEditing(null);
                          setNotice("Pairings saved.");
                        }
                      }}
                    />
                  ) : displayRound ? (
                    <>
                      <p className="round-label">
                        Round {displayRound.number}
                        {draft ? " · Preview" : ""}
                      </p>
                      <PairingsTable
                        round={displayRound}
                        names={people}
                        deletedPlayerIds={club.deletedPlayers?.map((p) => p.id)}
                        preview={!!draft}
                        pending={pending}
                        editable={
                          !!active &&
                          displayRound.number === event.rounds.length
                        }
                        onResult={(gameId, result) =>
                          void mutate({
                            type: "result",
                            tournamentId: event.id,
                            round: displayRound.number,
                            gameId,
                            result,
                          })
                        }
                      />
                    </>
                  ) : (
                    <p>No rounds yet.</p>
                  )}
                  <div className="actions">
                    {active && !!complete && !draft && !editing && (
                      <button
                        disabled={pending}
                        onClick={() => {
                          if (event.rounds.length < event.maxRounds)
                            setFinishing(true);
                          else
                            void mutate({
                              type: "finishSession",
                              tournamentId: event.id,
                            });
                        }}
                      >
                        Finish session
                      </button>
                    )}
                    {finishing && (
                      <>
                        <span>Finish after {event.rounds.length} round?</span>
                        <button
                          disabled={pending}
                          onClick={async () => {
                            if (
                              await mutate({
                                type: "finishSession",
                                tournamentId: event.id,
                                confirmEarly: true,
                              })
                            )
                              setFinishing(false);
                          }}
                        >
                          Confirm
                        </button>
                        <button onClick={() => setFinishing(false)}>
                          Cancel
                        </button>
                      </>
                    )}
                    {event.status === "completed" &&
                      event.id === club.tournaments.at(-1)?.id && (
                        <button
                          disabled={pending}
                          onClick={() =>
                            void mutate({
                              type: "reopenSession",
                              tournamentId: event.id,
                            })
                          }
                        >
                          Reopen
                        </button>
                      )}
                    {event.rounds.length > 0 && (
                      <button
                        onClick={() =>
                          download(
                            "results.csv",
                            [
                              [
                                "Session",
                                "Round",
                                "Board",
                                "White",
                                "Black",
                                "Result",
                              ],
                              ...event.rounds.flatMap((r) =>
                                r.games.map((g) => [
                                  event.name,
                                  r.number,
                                  g.board,
                                  people[g.white],
                                  g.black ? people[g.black] : "Bye",
                                  g.result ?? "pending",
                                ]),
                              ),
                            ]
                              .map((r) => r.map(csv).join(","))
                              .join("\r\n"),
                            "text/csv",
                          )
                        }
                      >
                        Export results
                      </button>
                    )}
                  </div>
                </section>
              </div>
              {event.mode==='tournament'?<TournamentStandings club={club} event={event}/>:<section className="panel">
                <h2>Session standings</h2>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Points</th>
                        <th>Elo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((s, i) => (
                        <tr key={s.id}>
                          <td>{i + 1}</td>
                          <td>{s.name}</td>
                          <td>{s.points}</td>
                          <td>{s.rating}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>}
            </>
          )}
        </>
      )}
      {tab === "ratings" && (
        <section className="panel">
          <div className="section-heading">
            <h2>Ratings</h2>
            <div className="actions">
              <input
                aria-label="Search players"
                placeholder="Search names"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button onClick={exportRatings}>Export CSV</button>
              <button
                onClick={() =>
                  download(
                    "club-backup.json",
                    JSON.stringify(club, null, 2),
                    "application/json",
                  )
                }
              >
                Backup
              </button>
            </div>
          </div>
          {owner&&!demo&&snapshot.sheetSync&&<p className="sheet-sync-status">
            <a href={snapshot.sheetSync.sheetUrl} target="_blank" rel="noopener noreferrer">Google Sheets</a>{' · '}
            {{not_connected:'Not connected',pending:'Waiting for update',synced:'Synced',stale:'No recent sync',error:'Sync needs attention'}[snapshot.sheetSync.status]}
            {snapshot.sheetSync.lastSyncedAt&&` · Last synced ${new Date(snapshot.sheetSync.lastSyncedAt).toLocaleString('en-CA',{timeZone:'America/Toronto'})}`}
          </p>}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Elo</th>
                  <th>Games</th>
                  <th>W / D / L</th>
                  <th>Total points</th>
                  {canDelete && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {[...club.players]
                  .sort(
                    (a, b) =>
                      stats[b.id].rating - stats[a.id].rating ||
                      a.name.localeCompare(b.name),
                  )
                  .filter((p) =>
                    p.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((p, i) => (
                    <tr key={p.id}>
                      <td>{i + 1}</td>
                      <td>{owner&&nameEdit?.id===p.id?<form className="name-edit" onSubmit={async e=>{
                        e.preventDefault();
                        if(await mutate({type:"editName",playerId:p.id,name:nameEdit.value},nameEdit.version)){
                          setNameEdit(null);setDraft(null);setNotice("Name updated.");
                        }
                      }}><div className="actions">
                        <input autoFocus aria-label={`Name for ${p.name}`} value={nameEdit.value} required maxLength={100} disabled={pending}
                          onChange={e=>setNameEdit({...nameEdit,value:e.target.value})}/>
                        <button type="submit" disabled={pending}>Save</button>
                        <button type="button" disabled={pending} onClick={()=>setNameEdit(null)}>Cancel</button>
                      </div></form>:p.name}</td>
                      <td>
                        {canDelete && ratingEdit?.id===p.id ? (
                          <form className="rating-edit" onSubmit={async e=>{
                            e.preventDefault();
                            if(await mutate({type:"editRating",playerId:p.id,rating:Number(ratingEdit.value)},ratingEdit.version)){
                              setRatingEdit(null);setDraft(null);setNotice("Rating updated.");
                            }
                          }}>
                            <div className="actions">
                              <input autoFocus type="number" min="100" max="3500" step="1" required
                                aria-label={`Rating for ${p.name}`} value={ratingEdit.value} disabled={pending}
                                onChange={e=>setRatingEdit({...ratingEdit,value:e.target.value})} />
                              <button type="submit" disabled={pending}>Save</button>
                              <button type="button" disabled={pending} onClick={()=>setRatingEdit(null)}>Cancel</button>
                            </div>
                            <small>Past games stay unchanged.</small>
                          </form>
                        ) : <strong>{stats[p.id].rating}</strong>}
                      </td>
                      <td>{stats[p.id].games}</td>
                      <td>
                        {stats[p.id].wins} / {stats[p.id].draws} /{" "}
                        {stats[p.id].losses}
                      </td>
                      <td>{stats[p.id].points}</td>
                      {canDelete && (
                        <td><div className="actions">
                          {owner&&<button disabled={pending} aria-label={`Edit name for ${p.name}`}
                            onClick={()=>{setError("");setNotice("");setRatingEdit(null);setNameEdit({id:p.id,value:p.name,version:snapshot!.version});}}>
                            Edit name
                          </button>}
                          <button disabled={pending} aria-label={`Edit rating for ${p.name}`}
                            onClick={()=>{setError("");setNotice("");setNameEdit(null);setRatingEdit({id:p.id,value:String(stats[p.id].rating),version:snapshot!.version});}}>
                            Edit rating
                          </button>
                          <button className="danger" disabled={pending}
                            aria-label={`Delete ${p.name}`}
                            onClick={() => {
                              setError("");
                              setDeleting({id:p.id,name:p.name,version:snapshot!.version});
                            }}>
                            Delete
                          </button>
                        </div></td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {owner && tab === "logs" && (
        <section className="panel">
          <h2>Logs</h2>
          {club.audit.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Time (Toronto)</th><th>Manager</th><th>Action</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {club.audit.map(entry=>(
                    <tr key={entry.id}>
                      <td><time dateTime={entry.at}>{new Date(entry.at).toLocaleString('en-CA',{timeZone:'America/Toronto'})}</time></td>
                      <td>{entry.actor}</td>
                      <td>{entry.action.replace(/([A-Z])/g,' $1').toLowerCase()}</td>
                      <td>{entry.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p>No activity yet.</p>}
        </section>
      )}
      {tab === "accounts" && (
        <>
          <ManagerAccounts
            club={club}
            isOwner={owner}
            demo={demo}
            onChanged={() => void refresh()}
          />
          {owner && (
            <form
              className="panel fields"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (await mutate({
                  type: "settings",
                  name: f.get("name"),
                  startingRating: Number(f.get("rating")),
                  kFactor: club.kFactor,
                })) setNotice("Settings saved.");
              }}
            >
              <h2>Club settings</h2>
              <label>
                Name
                <input
                  name="name"
                  defaultValue={club.name}
                  key={club.name}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Starting Elo
                <input
                  name="rating"
                  type="number"
                  defaultValue={club.startingRating}
                  min="100"
                  max="3000"
                  required
                />
              </label>
              <button disabled={pending}>Save</button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
