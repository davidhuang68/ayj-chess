import type { Game, Round, Tournament } from "./chess";

export type EditablePair = { id?: string; white: string; black: string | null };
export const resultLocked = (game: Game) =>
  game.result !== null && game.result !== "bye";
export const gamePlayers = (game: Game) =>
  [game.white, game.black].filter((id): id is string => !!id);

export function changePendingAttendance(
  event: Tournament,
  id: string,
  present: boolean,
) {
  const round = event.rounds.at(-1);
  if (!round) return;
  if (round.eligiblePlayers && !round.eligiblePlayers.includes(id)) return;
  let waiting = new Set(round.unpaired ?? []);
  if (!present) {
    round.games = round.games.filter((game) => {
      if (resultLocked(game) || !gamePlayers(game).includes(id)) return true;
      gamePlayers(game)
        .filter((other) => other !== id)
        .forEach((other) => waiting.add(other));
      return false;
    });
    waiting.delete(id);
  } else if (!round.games.some((game) => gamePlayers(game).includes(id)))
    waiting.add(id);
  const assigned = new Set(round.games.flatMap(gamePlayers));
  waiting = new Set(
    [...waiting].filter(
      (player) => !event.withdrawn.includes(player) && !assigned.has(player),
    ),
  );
  // An automatic bye can join an odd waiting group, avoiding a second bye.
  if (waiting.size % 2) {
    const bye = round.games.find((game) => game.result === "bye");
    if (bye) {
      round.games = round.games.filter((game) => game.id !== bye.id);
      waiting.add(bye.white);
    }
  }
  round.unpaired = [...waiting];
}

export function replacePendingPairings(
  event: Tournament,
  round: Round,
  input: unknown,
  allowRematches = false,
  previousSessions: Tournament[] = [],
  allowPastRematches = false,
) {
  if (!Array.isArray(input) || input.length > 100)
    throw new Error("Choose valid pairings.");
  const locked = round.games.filter(resultLocked);
  const lockedPlayers = new Set(locked.flatMap(gamePlayers));
  const eligible = (round.eligiblePlayers ?? event.roster).filter(
    (id) => event.roster.includes(id) && !event.withdrawn.includes(id) && !lockedPlayers.has(id),
  );
  const allowed = new Set(eligible),
    used = new Set<string>(),
    rowIds = new Set<string>();
  const editable = new Map(
    round.games
      .filter((game) => !resultLocked(game))
      .map((game) => [game.id, game]),
  );
  const pairs: EditablePair[] = input.map((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.white !== "string" ||
      (value.black !== null && typeof value.black !== "string")
    )
      throw new Error("Choose White and Black, or a bye.");
    const pair: EditablePair = { white: value.white, black: value.black };
    if (value.id !== undefined) {
      if (
        typeof value.id !== "string" ||
        !editable.has(value.id) ||
        rowIds.has(value.id)
      )
        throw new Error("Recorded games cannot be edited.");
      pair.id = value.id;
      rowIds.add(value.id);
    }
    for (const id of [pair.white, pair.black].filter(
      (id): id is string => id !== null,
    )) {
      if (!allowed.has(id))
        throw new Error("Choose a present player without a recorded result.");
      if (used.has(id))
        throw new Error("A player can appear only once in this round.");
      used.add(id);
    }
    if (pair.black) {
      const repeat = event.rounds
        .filter((old) => old.number < round.number)
        .some((old) =>
          old.games.some(
            (game) =>
              gamePlayers(game).includes(pair.white) &&
              gamePlayers(game).includes(pair.black!),
          ),
        );
      const pastRepeat=previousSessions.some(session=>session.rounds.some(old=>
        old.games.some(game=>game.black&&gamePlayers(game).includes(pair.white)&&gamePlayers(game).includes(pair.black!))));
      const unchangedOpponents = round.games.some(
        (game) =>
          game.black &&
          gamePlayers(game).includes(pair.white) &&
          gamePlayers(game).includes(pair.black!),
      );
      if ((repeat || (pastRepeat && !allowPastRematches)) && !unchangedOpponents && !allowRematches)
        throw new Error(
          "These players already played. Enable Allow rematches to pair them again.",
        );
    }
    return pair;
  });
  if (pairs.filter((pair) => pair.black === null).length > 1)
    throw new Error("A round can have only one bye.");
  const reserved = new Set([
    ...locked.map((game) => game.board),
    ...pairs
      .filter((pair) => pair.id)
      .map((pair) => editable.get(pair.id!)!.board),
  ]);
  const pending = pairs.map((pair) => {
    const old = pair.id ? editable.get(pair.id) : undefined;
    let board = old?.board ?? 1;
    if (!old) {
      while (reserved.has(board)) board++;
      reserved.add(board);
    }
    return {
      id:
        old && old.white === pair.white && old.black === pair.black
          ? old.id
          : crypto.randomUUID(),
      board,
      white: pair.white,
      black: pair.black,
      result: pair.black === null ? "bye" : null,
    } as Game;
  });
  round.games = [...locked, ...pending].sort((a, b) => a.board - b.board);
  round.unpaired = eligible.filter((id) => !used.has(id));
  round.warnings = [];
}
