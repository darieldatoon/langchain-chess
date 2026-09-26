// A snapshot of the five System 1 baseline experiments, 2026-09-26.
// The constants below were copied from the experiments in LangSmith (linked in the header) when
// this report was written; every figure on the page is computed from them. Do not regenerate.
import { Banner } from "@langchain/macaw-components/Banner";
import { Card } from "@langchain/macaw-components/Card";
import { Divider } from "@langchain/macaw-components/Divider";
import { Text } from "@langchain/macaw-components/Text";
import { CHART_CATEGORICAL_FILL_COLORS as FILL } from "@langchain/macaw-components/utils/chartColors";
import type { ReactNode } from "react";
import { Answer } from "../components/Answer";
import { DataTable } from "../components/DataTable";
import { MetricCard } from "../components/MetricCard";
import { PositionExample } from "../components/PositionExample";
import { ReportHeader, ReportPage } from "../components/ReportHeader";
import { RunBarChart } from "../components/RunBarChart";
import { Prose, Section } from "../components/Section";
import { num, pct, points } from "../format";

// ---- Data ---------------------------------------------------------------------------------

const DATASET = {
  name: "langchain-chess-positions",
  version: "v1",
  url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/datasets/8decb9c8-3313-4caf-929a-d236735ce539",
} as const;
const CONTEXT = {
  positions: 2000,
  randomTop1: 0.0562,
  randomTop5: 0.2353,
  humansBest: 0.417,
  over16: 0.8685,
  gitSha: "327e854",
} as const;
const RESULTS = {
  "semif-rich": {
    url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/datasets/8decb9c8-3313-4caf-929a-d236735ce539/compare?selectedSessions=c6c1ad12-191a-4789-9d22-f1ba72f4fa57",
    n: 2000.0,
    errors: 0,
    top1: 0.244,
    top5: 0.481,
    top3InTop5: 0.722,
    humanMatch: 0.244,
    cpLoss: 219.0,
    top1Single: 0.3308,
    top1Tournament: 0.2309,
    finalistRecall: 0.7173,
    requests: 1.869,
    inputTokens: null,
    gate: {
      "0.5": {
        kept: 0.4425,
        right: 0.3729,
      },
      "0.6": {
        kept: 0.3755,
        right: 0.4021,
      },
      "0.7": {
        kept: 0.3125,
        right: 0.4352,
      },
      "0.8": {
        kept: 0.2425,
        right: 0.4598,
      },
      "0.9": {
        kept: 0.1545,
        right: 0.5178,
      },
      "0.95": {
        kept: 0.091,
        right: 0.5989,
      },
    },
    bands: {
      "<1200": 0.265,
      "1200-1599": 0.2975,
      "1600-1999": 0.2375,
      "2000-2399": 0.1975,
      "2400+": 0.2225,
    },
    phases: {
      opening: 0.1985,
      middlegame: 0.2767,
      endgame: 0.2571,
    },
  },
  "semif-terse": {
    url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/datasets/8decb9c8-3313-4caf-929a-d236735ce539/compare?selectedSessions=a70cae90-de96-4829-8eb5-af59e3d46bba",
    n: 2000.0,
    errors: 0,
    top1: 0.171,
    top5: 0.481,
    top3InTop5: 0.7045,
    humanMatch: 0.172,
    cpLoss: 372.1,
    top1Single: 0.3232,
    top1Tournament: 0.148,
    finalistRecall: 0.7334,
    requests: 1.869,
    inputTokens: null,
    gate: {
      "0.5": {
        kept: 0.311,
        right: 0.2331,
      },
      "0.6": {
        kept: 0.23,
        right: 0.237,
      },
      "0.7": {
        kept: 0.1585,
        right: 0.265,
      },
      "0.8": {
        kept: 0.0835,
        right: 0.2934,
      },
      "0.9": {
        kept: 0.037,
        right: 0.3649,
      },
      "0.95": {
        kept: 0.0155,
        right: 0.3871,
      },
    },
    bands: {
      "<1200": 0.1775,
      "1200-1599": 0.1925,
      "1600-1999": 0.165,
      "2000-2399": 0.145,
      "2400+": 0.175,
    },
    phases: {
      opening: 0.1403,
      middlegame: 0.1835,
      endgame: 0.1895,
    },
  },
  "jev-rich": {
    url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/datasets/8decb9c8-3313-4caf-929a-d236735ce539/compare?selectedSessions=92d7090d-36eb-4e70-ac52-26b05b5d452e",
    n: 2000.0,
    errors: 0,
    top1: 0.272,
    top5: 0.585,
    top3InTop5: 0.8275,
    humanMatch: 0.2905,
    cpLoss: 160.0,
    top1Single: 0.3574,
    top1Tournament: 0.2591,
    finalistRecall: null,
    requests: 1.0,
    inputTokens: 1582,
    gate: {
      "0.5": {
        kept: 0.313,
        right: 0.4537,
      },
      "0.6": {
        kept: 0.272,
        right: 0.4743,
      },
      "0.7": {
        kept: 0.2265,
        right: 0.5166,
      },
      "0.8": {
        kept: 0.1585,
        right: 0.5899,
      },
      "0.9": {
        kept: 0.0755,
        right: 0.7152,
      },
      "0.95": {
        kept: 0.0275,
        right: 0.7273,
      },
    },
    bands: {
      "<1200": 0.265,
      "1200-1599": 0.315,
      "1600-1999": 0.2675,
      "2000-2399": 0.245,
      "2400+": 0.2675,
    },
    phases: {
      opening: 0.2254,
      middlegame: 0.2857,
      endgame: 0.3053,
    },
  },
  "jev-terse": {
    url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/datasets/8decb9c8-3313-4caf-929a-d236735ce539/compare?selectedSessions=1ebd3471-6f6e-42b7-bd55-3f37806e6a68",
    n: 2000.0,
    errors: 0,
    top1: 0.1945,
    top5: 0.5465,
    top3InTop5: 0.767,
    humanMatch: 0.201,
    cpLoss: 354.9,
    top1Single: 0.3688,
    top1Tournament: 0.1681,
    finalistRecall: null,
    requests: 1.0,
    inputTokens: 1169,
    gate: {
      "0.5": {
        kept: 0.2715,
        right: 0.2873,
      },
      "0.6": {
        kept: 0.2035,
        right: 0.3194,
      },
      "0.7": {
        kept: 0.135,
        right: 0.3704,
      },
      "0.8": {
        kept: 0.054,
        right: 0.5,
      },
      "0.9": {
        kept: 0.0075,
        right: 0.6667,
      },
      "0.95": {
        kept: 0.0005,
        right: 1.0,
      },
    },
    bands: {
      "<1200": 0.225,
      "1200-1599": 0.2175,
      "1600-1999": 0.2,
      "2000-2399": 0.1575,
      "2400+": 0.1725,
    },
    phases: {
      opening: 0.1597,
      middlegame: 0.2105,
      endgame: 0.2135,
    },
  },
  "jev-rich-cap16": {
    url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/datasets/8decb9c8-3313-4caf-929a-d236735ce539/compare?selectedSessions=d51766b5-5205-4327-acf7-c719bf07d22a",
    n: 2000.0,
    errors: 0,
    top1: 0.2705,
    top5: 0.591,
    top3InTop5: 0.828,
    humanMatch: 0.291,
    cpLoss: 154.8,
    top1Single: 0.365,
    top1Tournament: 0.2562,
    finalistRecall: 0.821,
    requests: 1.869,
    inputTokens: 2680,
    gate: {
      "0.5": {
        kept: 0.325,
        right: 0.4385,
      },
      "0.6": {
        kept: 0.282,
        right: 0.4628,
      },
      "0.7": {
        kept: 0.234,
        right: 0.5107,
      },
      "0.8": {
        kept: 0.179,
        right: 0.5726,
      },
      "0.9": {
        kept: 0.092,
        right: 0.6739,
      },
      "0.95": {
        kept: 0.045,
        right: 0.8,
      },
    },
    bands: {
      "<1200": 0.28,
      "1200-1599": 0.315,
      "1600-1999": 0.2725,
      "2000-2399": 0.215,
      "2400+": 0.27,
    },
    phases: {
      opening: 0.2254,
      middlegame: 0.2887,
      endgame: 0.2977,
    },
  },
} as const;
const EXAMPLES = {
  hit: {
    id: "5ClXN2AH-016",
    fen: "r3k2r/ppp1pp1p/2nq1npb/3p1b2/3P1P2/2PBP2P/PPQN2P1/R1B1K1NR w KQkq - 1 9",
    lastMove: "g4f5",
    orientation: "white",
    fullmove: 9,
    rating: 1194,
    band: "<1200",
    phase: "middlegame",
    legal: 34,
    tactic: true,
    played: "Ngf3",
    playedIsBest: false,
    gameUrl: "https://lichess.org/5ClXN2AH#16",
    best: "d3f5",
    engine: [
      {
        san: "Bxf5",
        eval: "+1.6",
      },
      {
        san: "Ne2",
        eval: "+0.1",
      },
      {
        san: "g4",
        eval: "+0.1",
      },
      {
        san: "b4",
        eval: "-0.0",
      },
      {
        san: "b3",
        eval: "-0.2",
      },
    ],
    picks: [
      {
        run: "semif-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/c6c1ad12-191a-4789-9d22-f1ba72f4fa57/r/01a0dec0-a61c-76d3-8a44-78cb7d209748",
        top: "d3f5",
        margin: 0.967,
        cpLoss: 0,
        bestInFinal: true,
        moves: [
          {
            san: "Bxf5",
            probability: 0.974,
            engineRank: 1,
          },
          {
            san: "Kd1",
            probability: 0.007,
            engineRank: 7,
          },
          {
            san: "e4",
            probability: 0.005,
            engineRank: 22,
          },
          {
            san: "Ndf3",
            probability: 0.004,
            engineRank: 10,
          },
          {
            san: "Bb5",
            probability: 0.002,
            engineRank: 30,
          },
        ],
      },
      {
        run: "jev-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/92d7090d-36eb-4e70-ac52-26b05b5d452e/r/01a0dee0-852d-79a2-8626-77326a966981",
        top: "d3f5",
        margin: 0.83,
        cpLoss: 0,
        bestInFinal: null,
        moves: [
          {
            san: "Bxf5",
            probability: 0.87,
            engineRank: 1,
          },
          {
            san: "Ndf3",
            probability: 0.04,
            engineRank: 10,
          },
          {
            san: "Ngf3",
            probability: 0.04,
            engineRank: 6,
          },
          {
            san: "Be2",
            probability: 0.02,
            engineRank: 31,
          },
          {
            san: "Bb5",
            probability: 0.01,
            engineRank: 30,
          },
        ],
      },
    ],
  },
  shortlist: {
    id: "4GeDdgL0-011",
    fen: "r1bqkb1r/pp1p1ppp/2n1pn2/1B6/4P3/5N2/PPP2PPP/RNBQK2R b KQkq - 3 6",
    lastMove: "f1b5",
    orientation: "black",
    fullmove: 6,
    rating: 1755,
    band: "1600-1999",
    phase: "opening",
    legal: 33,
    tactic: true,
    played: "a6",
    playedIsBest: false,
    gameUrl: "https://lichess.org/4GeDdgL0#11",
    best: "d8a5",
    engine: [
      {
        san: "Qa5+",
        eval: "+1.6",
      },
      {
        san: "Nxe4",
        eval: "+1.3",
      },
      {
        san: "d5",
        eval: "+0.1",
      },
      {
        san: "Qc7",
        eval: "+0.1",
      },
      {
        san: "Bc5",
        eval: "+0.0",
      },
    ],
    picks: [
      {
        run: "semif-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/c6c1ad12-191a-4789-9d22-f1ba72f4fa57/r/01a0deb0-4391-7de3-9077-7edaef8c470d",
        top: "f6e4",
        margin: 0.891,
        cpLoss: 25,
        bestInFinal: true,
        moves: [
          {
            san: "Nxe4",
            probability: 0.927,
            engineRank: 2,
          },
          {
            san: "Qa5+",
            probability: 0.036,
            engineRank: 1,
          },
          {
            san: "g6",
            probability: 0.007,
            engineRank: 23,
          },
          {
            san: "Qb6",
            probability: 0.006,
            engineRank: 8,
          },
          {
            san: "Nd5",
            probability: 0.006,
            engineRank: 32,
          },
        ],
      },
    ],
  },
  costly: {
    id: "2zLLwiOR-028",
    fen: "r2qr1k1/pp1nppbp/5np1/3P1b2/3p4/1PN1PNPP/PB3PB1/2RQR1K1 w - - 0 15",
    lastMove: "c5d4",
    orientation: "white",
    fullmove: 15,
    rating: 2003,
    band: "2000-2399",
    phase: "opening",
    legal: 36,
    tactic: true,
    played: "Nxd4",
    playedIsBest: true,
    gameUrl: "https://lichess.org/2zLLwiOR#28",
    best: "f3d4",
    engine: [
      {
        san: "Nxd4",
        eval: "+5.6",
      },
      {
        san: "exd4",
        eval: "+2.2",
      },
      {
        san: "Qxd4",
        eval: "+1.9",
      },
      {
        san: "Nb5",
        eval: "+0.1",
      },
      {
        san: "Ne2",
        eval: "-0.3",
      },
    ],
    picks: [
      {
        run: "semif-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/c6c1ad12-191a-4789-9d22-f1ba72f4fa57/r/01a0deb4-ec07-7041-8e6f-f3805f404770",
        top: "e3d4",
        margin: 0.0,
        cpLoss: 341,
        bestInFinal: true,
        moves: [
          {
            san: "exd4",
            probability: 0.355,
            engineRank: 2,
          },
          {
            san: "Qxd4",
            probability: 0.355,
            engineRank: 3,
          },
          {
            san: "Nxd4",
            probability: 0.244,
            engineRank: 1,
          },
          {
            san: "e4",
            probability: 0.018,
            engineRank: 31,
          },
          {
            san: "Qe2",
            probability: 0.007,
            engineRank: 12,
          },
        ],
      },
      {
        run: "jev-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/92d7090d-36eb-4e70-ac52-26b05b5d452e/r/01a0dedf-d10b-7443-86a7-36c5534dbf21",
        top: "f3d4",
        margin: 0.32,
        cpLoss: 0,
        bestInFinal: null,
        moves: [
          {
            san: "Nxd4",
            probability: 0.6,
            engineRank: 1,
          },
          {
            san: "exd4",
            probability: 0.28,
            engineRank: 2,
          },
          {
            san: "Qxd4",
            probability: 0.1,
            engineRank: 3,
          },
          {
            san: "Ng5",
            probability: 0.02,
            engineRank: 8,
          },
          {
            san: "Ne5",
            probability: 0.0,
            engineRank: 30,
          },
        ],
      },
    ],
  },
  richVsTerse: {
    id: "2cIhF5Gp-051",
    fen: "2k5/ppp3p1/2n5/2r1N3/5B2/2P3P1/P6K/4R3 b - - 2 26",
    lastMove: "c4e5",
    orientation: "black",
    fullmove: 26,
    rating: 2058,
    band: "2000-2399",
    phase: "endgame",
    legal: 21,
    tactic: true,
    played: "Rxc3",
    playedIsBest: true,
    gameUrl: "https://lichess.org/2cIhF5Gp#51",
    best: "c5c3",
    engine: [
      {
        san: "Rxc3",
        eval: "-4.1",
      },
      {
        san: "Nd8",
        eval: "-4.8",
      },
      {
        san: "g5",
        eval: "-5.0",
      },
      {
        san: "b5",
        eval: "-5.2",
      },
      {
        san: "Na5",
        eval: "-5.3",
      },
    ],
    picks: [
      {
        run: "semif-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/c6c1ad12-191a-4789-9d22-f1ba72f4fa57/r/01a0dead-7ce1-7b61-a823-b3e498f5ca66",
        top: "c5c3",
        margin: 0.39,
        cpLoss: 0,
        bestInFinal: true,
        moves: [
          {
            san: "Rxc3",
            probability: 0.669,
            engineRank: 1,
          },
          {
            san: "Nxe5",
            probability: 0.279,
            engineRank: 6,
          },
          {
            san: "Rxe5",
            probability: 0.02,
            engineRank: 17,
          },
          {
            san: "b5",
            probability: 0.008,
            engineRank: 4,
          },
          {
            san: "Nd4",
            probability: 0.006,
            engineRank: 18,
          },
        ],
      },
      {
        run: "semif-terse",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/a70cae90-de96-4829-8eb5-af59e3d46bba/r/01a0dec9-eb6b-7180-b892-8441747ce9e3",
        top: "c5e5",
        margin: 0.229,
        cpLoss: 303,
        bestInFinal: true,
        moves: [
          {
            san: "Rxe5",
            probability: 0.583,
            engineRank: 17,
          },
          {
            san: "Nxe5",
            probability: 0.354,
            engineRank: 6,
          },
          {
            san: "Kd8",
            probability: 0.016,
            engineRank: 10,
          },
          {
            san: "Ne7",
            probability: 0.016,
            engineRank: 11,
          },
          {
            san: "Nd4",
            probability: 0.012,
            engineRank: 18,
          },
        ],
      },
    ],
  },
  knockout: {
    id: "2HZOEpIR-012",
    fen: "rn2kbnr/pppq2pp/3p4/4p3/4Pp2/3P1N2/PPP2PPP/RNBQ1RK1 w kq - 0 7",
    lastMove: "f5f4",
    orientation: "white",
    fullmove: 7,
    rating: 1241,
    band: "1200-1599",
    phase: "opening",
    legal: 28,
    tactic: false,
    played: "Nbd2",
    playedIsBest: false,
    gameUrl: "https://lichess.org/2HZOEpIR#12",
    best: "b1c3",
    engine: [
      {
        san: "Nc3",
        eval: "+0.6",
      },
      {
        san: "d4",
        eval: "+0.6",
      },
      {
        san: "b4",
        eval: "+0.5",
      },
      {
        san: "c4",
        eval: "+0.5",
      },
      {
        san: "a4",
        eval: "+0.5",
      },
    ],
    picks: [
      {
        run: "semif-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/c6c1ad12-191a-4789-9d22-f1ba72f4fa57/r/01a0deb7-a1ef-7bf2-8948-807a3415a592",
        top: "a2a3",
        margin: 0.093,
        cpLoss: 57,
        bestInFinal: false,
        moves: [
          {
            san: "a3",
            probability: 0.237,
            engineRank: 11,
          },
          {
            san: "Nfd2",
            probability: 0.143,
            engineRank: 19,
          },
          {
            san: "g3",
            probability: 0.077,
            engineRank: 8,
          },
          {
            san: "Nxe5",
            probability: 0.077,
            engineRank: 17,
          },
          {
            san: "Bd2",
            probability: 0.068,
            engineRank: 16,
          },
        ],
      },
      {
        run: "jev-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/92d7090d-36eb-4e70-ac52-26b05b5d452e/r/01a0dedf-fc46-7241-9fc9-d9ce2a3e5dc1",
        top: "b1c3",
        margin: 0.04,
        cpLoss: 0,
        bestInFinal: null,
        moves: [
          {
            san: "Nc3",
            probability: 0.19,
            engineRank: 1,
          },
          {
            san: "Ng5",
            probability: 0.15,
            engineRank: 23,
          },
          {
            san: "d4",
            probability: 0.15,
            engineRank: 2,
          },
          {
            san: "Nh4",
            probability: 0.06,
            engineRank: 21,
          },
          {
            san: "Nbd2",
            probability: 0.05,
            engineRank: 10,
          },
        ],
      },
    ],
  },
  gateRight: {
    id: "1SJSdNQa-027",
    fen: "r1bq1rk1/1pp2p2/p1n2n1p/4P3/6p1/2N1P1P1/PP1NBPP1/R2Q1RK1 b - - 0 14",
    lastMove: "d4e5",
    orientation: "black",
    fullmove: 14,
    rating: 1300,
    band: "1200-1599",
    phase: "opening",
    legal: 34,
    tactic: true,
    played: "Nxe5",
    playedIsBest: true,
    gameUrl: "https://lichess.org/1SJSdNQa#27",
    best: "c6e5",
    engine: [
      {
        san: "Nxe5",
        eval: "-0.6",
      },
      {
        san: "Nd5",
        eval: "-3.1",
      },
      {
        san: "Nh7",
        eval: "-3.7",
      },
      {
        san: "Nd7",
        eval: "-4.0",
      },
      {
        san: "Ne8",
        eval: "-4.1",
      },
    ],
    picks: [
      {
        run: "semif-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/c6c1ad12-191a-4789-9d22-f1ba72f4fa57/r/01a0deb9-7145-7ce0-bb74-42cae7c35b05",
        top: "c6e5",
        margin: 0.994,
        cpLoss: 0,
        bestInFinal: true,
        moves: [
          {
            san: "Nxe5",
            probability: 0.996,
            engineRank: 1,
          },
          {
            san: "Ne7",
            probability: 0.001,
            engineRank: 26,
          },
          {
            san: "Nd5",
            probability: 0.001,
            engineRank: 2,
          },
          {
            san: "Qxd2",
            probability: 0.0,
            engineRank: 29,
          },
          {
            san: "Nb4",
            probability: 0.0,
            engineRank: 11,
          },
        ],
      },
    ],
  },
  gateWrong: {
    id: "2751XrvF-029",
    fen: "r4rk1/ppp2ppp/2b1p3/4q3/4pQ2/P1P1P1PP/1P3P2/R1B1K2R b KQ - 1 15",
    lastMove: "g4f4",
    orientation: "black",
    fullmove: 15,
    rating: 1260,
    band: "1200-1599",
    phase: "middlegame",
    legal: 36,
    tactic: false,
    played: "Qd5",
    playedIsBest: false,
    gameUrl: "https://lichess.org/2751XrvF#29",
    best: "e5b5",
    engine: [
      {
        san: "Qb5",
        eval: "+5.1",
      },
      {
        san: "Qd5",
        eval: "+5.1",
      },
      {
        san: "Qc5",
        eval: "+4.5",
      },
      {
        san: "Qa5",
        eval: "+4.5",
      },
      {
        san: "Qh5",
        eval: "+4.5",
      },
    ],
    picks: [
      {
        run: "semif-rich",
        url: "https://smith.langchain.com/o/f56bee33-7a4a-4f21-90ea-f6c8cc25ab68/projects/p/c6c1ad12-191a-4789-9d22-f1ba72f4fa57/r/01a0deba-4be0-7dc3-9c41-d86e61e4a825",
        top: "e5f4",
        margin: 0.918,
        cpLoss: 339,
        bestInFinal: false,
        moves: [
          {
            san: "Qxf4",
            probability: 0.938,
            engineRank: 9,
          },
          {
            san: "h5",
            probability: 0.019,
            engineRank: 23,
          },
          {
            san: "Qd6",
            probability: 0.01,
            engineRank: 6,
          },
          {
            san: "Rae8",
            probability: 0.008,
            engineRank: 25,
          },
          {
            san: "Kh8",
            probability: 0.006,
            engineRank: 34,
          },
        ],
      },
    ],
  },
} as const;

// ---- Derived ------------------------------------------------------------------------------

type RunKey = keyof typeof RESULTS;
type Example = (typeof EXAMPLES)[keyof typeof EXAMPLES];

const RUNS: readonly { key: RunKey; label: string; color: string }[] = [
  { key: "semif-rich", label: "SemIf rich", color: FILL[0] },
  { key: "semif-terse", label: "SemIf terse", color: FILL[8] },
  { key: "jev-rich", label: "Jev rich", color: FILL[9] },
  { key: "jev-terse", label: "Jev terse", color: FILL[1] },
  { key: "jev-rich-cap16", label: "Jev rich, capped at 16", color: FILL[17] },
];
const LABEL = Object.fromEntries(RUNS.map((r) => [r.key, r.label])) as Record<RunKey, string>;
const THRESHOLDS = ["0.5", "0.6", "0.7", "0.8", "0.9", "0.95"] as const;
const PRODUCTION_THRESHOLD = "0.9";
/** Accuracy over fewer kept positions than this is noise. */
const SMALL_SAMPLE = 50;
const BANDS = ["<1200", "1200-1599", "1600-1999", "2000-2399", "2400+"] as const;
const PHASES = ["opening", "middlegame", "endgame"] as const;

const r = (key: RunKey) => RESULTS[key];
const bars = (metric: (key: RunKey) => number | null) =>
  RUNS.map((run) => ({ label: run.label, value: metric(run.key), color: run.color }));
const gate = (key: RunKey, t: (typeof THRESHOLDS)[number]) => r(key).gate[t];

function context(ex: Example) {
  const who = ex.orientation === "white" ? "White" : "Black";
  return (
    <>
      {who} to move, move {ex.fullmove}. The player to move was rated {ex.rating} and played{" "}
      <strong className="font-semibold text-primary">{ex.played}</strong>
      {ex.playedIsBest ? ", the engine's best." : "."}
    </>
  );
}

function Position({ ex, title, children }: { ex: Example; title: string; children: ReactNode }) {
  return (
    <PositionExample
      title={title}
      tags={[
        ex.band,
        capitalize(ex.phase),
        `${ex.legal} legal moves`,
        ...(ex.tactic ? ["Tactic"] : []),
      ]}
      fen={ex.fen}
      lastMove={ex.lastMove}
      orientation={ex.orientation}
      best={ex.best}
      engine={ex.engine}
      picks={ex.picks.map((p) => ({ label: LABEL[p.run], url: p.url, top: p.top, moves: p.moves }))}
      gameUrl={ex.gameUrl}
      positionId={ex.id}
      context={context(ex)}
    >
      {children}
    </PositionExample>
  );
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const B = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-primary">{children}</strong>
);
const M = ({ children }: { children: ReactNode }) => (
  <code className="rounded-sm bg-surface-level-3 px-space-1 font-mono text-xs">{children}</code>
);

// ---- The report ---------------------------------------------------------------------------

export const title = "System 1 baseline · 2026-09-26 · langchain-chess";

export default function Report() {
  const failures = RUNS.reduce((sum, run) => sum + r(run.key).errors, 0);
  const knockedOut = 1 - (r("semif-rich").finalistRecall ?? 0);
  const ex = EXAMPLES;
  return (
    <ReportPage>
      <ReportHeader
        eyebrow="langchain-chess evals · 2026-09-26"
        title="How well does System 1 rank chess moves?"
        linksLabel="In LangSmith:"
        links={[
          { href: DATASET.url, label: `Dataset: ${DATASET.name}@${DATASET.version}` },
          ...RUNS.map((run) => ({ href: r(run.key).url, label: `${run.label} experiment` })),
        ]}
        contents={[
          { id: "setup", label: "Background" },
          { id: "q1", label: "1 · Top pick" },
          { id: "q2", label: "2 · Shortlist" },
          { id: "q3", label: "3 · Cost of misses" },
          { id: "q4", label: "4 · Descriptions" },
          { id: "q5", label: "5 · Tournament" },
          { id: "q6", label: "6 · Gate" },
          { id: "q7", label: "7 · Level and phase" },
          { id: "q8", label: "8 · Human or engine" },
          { id: "next", label: "Takeaways" },
        ]}
      >
        A baseline of the two System 1 models, SemIf and Jev, on {num(CONTEXT.positions)} positions
        from real Lichess games labelled by Stockfish. Each section asks one question, answers it,
        and shows a real position that makes the answer concrete.
      </ReportHeader>

      <div className="grid grid-cols-2 gap-space-3 lg:grid-cols-4">
        <MetricCard
          label="Best top-1 accuracy"
          value={pct(r("jev-rich").top1)}
          hint={`Jev rich · random guessing ${pct(CONTEXT.randomTop1)}`}
        />
        <MetricCard
          label="Best top-5 accuracy"
          value={pct(r("jev-rich").top5)}
          hint={`Jev rich · random guessing ${pct(CONTEXT.randomTop5)}`}
        />
        <MetricCard
          label="Positions per run"
          value={num(CONTEXT.positions)}
          hint={`${pct(CONTEXT.over16, 0)} have more than 16 legal moves`}
        />
        <MetricCard
          label="Failed rankings"
          value={num(failures)}
          hint={`across ${num(CONTEXT.positions * RUNS.length)} rankings`}
        />
      </div>

      <Card className="flex flex-col gap-space-3 bg-surface-level-1">
        <Text variant="h4">TL;DR</Text>
        <ul className="flex list-disc flex-col gap-space-2 pl-space-5 text-sm text-secondary">
          <li>
            <B>Jev with rich descriptions ranks best:</B> its top pick is Stockfish's best move{" "}
            {pct(r("jev-rich").top1)} of the time, and the best move is in its top 5{" "}
            {pct(r("jev-rich").top5)} of the time. SemIf rich: {pct(r("semif-rich").top1)} and{" "}
            {pct(r("semif-rich").top5)}.
          </li>
          <li>
            <B>Rich move descriptions matter:</B>{" "}
            {points(r("semif-rich").top1, r("semif-terse").top1)} and{" "}
            {points(r("jev-rich").top1, r("jev-terse").top1)} points of top-1 accuracy on SemIf and
            Jev, and the moves picked lose less when wrong.
          </li>
          <li>
            <B>SemIf's tournament isn't what holds it back:</B> forcing the same knockout onto Jev
            barely changes Jev's score ({pct(r("jev-rich-cap16").top1)} vs {pct(r("jev-rich").top1)}
            ). The gap is the model.
          </li>
          <li>
            <B>At the production gate (margin ≥ {PRODUCTION_THRESHOLD}),</B> SemIf would play{" "}
            {pct(gate("semif-rich", PRODUCTION_THRESHOLD).kept)} of moves on its own and be right{" "}
            {pct(gate("semif-rich", PRODUCTION_THRESHOLD).right)} of the time; Jev would play{" "}
            {pct(gate("jev-rich", PRODUCTION_THRESHOLD).kept)} and be right{" "}
            {pct(gate("jev-rich", PRODUCTION_THRESHOLD).right)}.
          </li>
        </ul>
      </Card>

      <Section id="setup" eyebrow="Background" title="What we're measuring">
        <Prose>
          The agent is a System 1 + System 2 player. <B>System 1</B> (SemIf or Jev) is a fast
          classifier that ranks every legal move and says how sure it is. A <B>gate</B> then
          decides: if System 1's margin (top probability minus second) clears a threshold, System 1
          plays alone and the LLM never runs. Otherwise the LLM (System 2) gets System 1's top 5 as
          a shortlist.
        </Prose>
        <Prose>
          So two things matter: how often System 1's <B>top pick</B> is right, because it plays that
          move when it's confident, and how often the best move is in its <B>top 5</B>, because
          that's what the LLM sees.
        </Prose>
        <div className="grid gap-space-3 md:grid-cols-3">
          <Card>
            <Text variant="h6">The positions</Text>
            <Prose>
              {num(CONTEXT.positions)} positions from rated rapid and classical Lichess games (June
              2018): 400 per rating band, split evenly across opening, middlegame and endgame. Each
              carries the real game history, as System 1 sees it in play.
            </Prose>
          </Card>
          <Card>
            <Text variant="h6">The answer key</Text>
            <Prose>
              Stockfish 19 at depth 16 scores every legal move. <M>best</M> is its top move. Humans
              in these games played it {pct(CONTEXT.humansBest)} of the time.
            </Prose>
          </Card>
          <Card>
            <Text variant="h6">The runs</Text>
            <Prose>
              Two models × two description styles, plus Jev capped at 16 options to isolate SemIf's
              tournament. <B>Rich</B> descriptions list board-verified facts about each move;{" "}
              <B>terse</B> ones give the move and one fact.
            </Prose>
          </Card>
        </div>
        <Banner intent="warning" title="How much to trust small gaps">
          Each run is one pass over {num(CONTEXT.positions)} positions, so a top-1 accuracy near 25%
          has a 95% interval of about ±2 points. Treat gaps under 3 points as noise. Every average
          weighs each rating band and phase equally, not by how common they are on Lichess.
        </Banner>
      </Section>
      <Divider />

      <Section
        id="q1"
        eyebrow="Question 1"
        title="How often is System 1's top pick Stockfish's best move?"
      >
        <Prose>
          This is <M>recall@1</M>: the share of positions where System 1's highest-ranked move is
          Stockfish's best. It's what System 1 plays whenever the gate lets it.
        </Prose>
        <RunBarChart
          title="Top-1 accuracy (recall@1)"
          description={`Shaded: picking a legal move at random (${pct(CONTEXT.randomTop1)}). Humans played Stockfish's best ${pct(CONTEXT.humansBest)} of the time.`}
          bars={bars((k) => r(k).top1)}
          max={0.5}
          chance={CONTEXT.randomTop1}
        />
        <Answer>
          About a quarter of the time: {pct(r("semif-rich").top1)} for SemIf rich and{" "}
          {pct(r("jev-rich").top1)} for Jev rich. That's roughly five times better than guessing,
          and well short of the {pct(CONTEXT.humansBest)} the humans managed.
        </Answer>
        <Position ex={ex.hit} title="Both models find the best move">
          A clean hit. Bishop takes f5 wins material, and both models rank it first by a wide
          margin. SemIf's margin of <B>{ex.hit.picks[0].margin.toFixed(2)}</B> would clear the
          production gate, so SemIf would play it without calling the LLM.
        </Position>
      </Section>
      <Divider />

      <Section id="q2" eyebrow="Question 2" title="Is the best move in the shortlist the LLM sees?">
        <Prose>
          When the gate doesn't clear, the LLM chooses from System 1's top 5. <M>recall@5</M> asks
          whether Stockfish's best move is in it; <M>top3_in_top5</M> asks, more forgivingly,
          whether any of Stockfish's top 3 is.
        </Prose>
        <RunBarChart
          title="Best move in the top 5 (recall@5)"
          description={`Shaded: five random legal moves (${pct(CONTEXT.randomTop5)}).`}
          bars={bars((k) => r(k).top5)}
          chance={CONTEXT.randomTop5}
        />
        <RunBarChart
          title="Any of Stockfish's top 3 in the top 5"
          bars={bars((k) => r(k).top3InTop5)}
        />
        <Answer>
          About half the time for SemIf ({pct(r("semif-rich").top5)}) and closer to 60% for Jev (
          {pct(r("jev-rich").top5)}). A strong move of some kind is usually there: Jev rich's
          shortlist holds one of Stockfish's top 3 in {pct(r("jev-rich").top3InTop5)} of positions.
        </Answer>
        <Position ex={ex.shortlist} title="The shortlist saves it">
          SemIf's top pick, knight takes e4, is Stockfish's second choice and only a quarter of a
          pawn worse. The best move, the queen check, is SemIf's number 2, so the LLM would see it.
          SemIf's margin (<B>{ex.shortlist.picks[0].margin.toFixed(2)}</B>) falls just short of{" "}
          {PRODUCTION_THRESHOLD}, so this position goes to the LLM.
        </Position>
      </Section>
      <Divider />

      <Section id="q3" eyebrow="Question 3" title="When System 1 is wrong, how costly is it?">
        <Prose>
          Not all misses are equal. <M>cp_loss</M> is how many centipawns (hundredths of a pawn)
          System 1's top move gives up against Stockfish's best, capped at 1,000. Zero when it's
          right.
        </Prose>
        <RunBarChart
          title="Mean centipawn loss of the top pick (lower is better)"
          description="Averaged over every position, including the ones System 1 gets right."
          bars={bars((k) => r(k).cpLoss)}
          max={400}
          format={(v) => num(v)}
        />
        <Answer>
          Jev rich gives up about {num(r("jev-rich").cpLoss / 100, 1)} pawns per move on average,
          SemIf rich about {num(r("semif-rich").cpLoss / 100, 1)}. Terse descriptions make both much
          worse ({num(r("semif-terse").cpLoss)} and {num(r("jev-terse").cpLoss)} centipawns): their
          mistakes are bigger, not just more frequent.
        </Answer>
        <Position ex={ex.costly} title="A costly miss">
          Knight takes d4 wins material, and Stockfish rates it{" "}
          {num(ex.costly.picks[0].cpLoss / 100, 1)} pawns better than SemIf's pick. SemIf splits its
          vote between three captures and puts the right one third. Jev ranks it first. SemIf's
          margin here is <B>{ex.costly.picks[0].margin.toFixed(2)}</B>, so the gate would hand this
          position to the LLM: low confidence is doing its job.
        </Position>
      </Section>
      <Divider />

      <Section id="q4" eyebrow="Question 4" title="Do richer move descriptions help?">
        <Prose>
          Each option System 1 ranks comes with a description. Rich ones list what the move
          captures, whether it checks, whether the destination is defended, and the exchange result.
          Terse ones give the move and one fact. Rich costs more input tokens.
        </Prose>
        <DataTable
          head={[
            "Model",
            "Top-1, rich",
            "Top-1, terse",
            "Top-5, rich",
            "Top-5, terse",
            "cp loss, rich",
            "cp loss, terse",
            "Input tokens, rich",
            "Input tokens, terse",
          ]}
          rows={[
            [
              "SemIf",
              pct(r("semif-rich").top1),
              pct(r("semif-terse").top1),
              pct(r("semif-rich").top5),
              pct(r("semif-terse").top5),
              num(r("semif-rich").cpLoss),
              num(r("semif-terse").cpLoss),
              "not reported",
              "not reported",
            ],
            [
              "Jev",
              pct(r("jev-rich").top1),
              pct(r("jev-terse").top1),
              pct(r("jev-rich").top5),
              pct(r("jev-terse").top5),
              num(r("jev-rich").cpLoss),
              num(r("jev-terse").cpLoss),
              num(r("jev-rich").inputTokens),
              num(r("jev-terse").inputTokens),
            ],
          ]}
        />
        <Answer>
          Yes, for picking the single best move: rich adds{" "}
          {points(r("semif-rich").top1, r("semif-terse").top1)} points of top-1 accuracy on SemIf
          and {points(r("jev-rich").top1, r("jev-terse").top1)} on Jev, and cuts centipawn loss by{" "}
          {pct(1 - r("semif-rich").cpLoss / r("semif-terse").cpLoss, 0)} and{" "}
          {pct(1 - r("jev-rich").cpLoss / r("jev-terse").cpLoss, 0)}. The shortlist changes less
          (SemIf's top 5 is {pct(r("semif-rich").top5)} either way). For Jev, rich costs about{" "}
          {num(r("jev-rich").inputTokens! - r("jev-terse").inputTokens!)} more input tokens per
          ranking (+
          {pct(r("jev-rich").inputTokens! / r("jev-terse").inputTokens! - 1, 0)}).
        </Answer>
        <Position ex={ex.richVsTerse} title="Richer descriptions find the tactic">
          An endgame where rook takes c3 is best. With rich descriptions SemIf ranks it first; with
          terse ones it prefers rook takes e5, Stockfish's{" "}
          {ordinal(ex.richVsTerse.picks[1].moves[0].engineRank)} choice, which loses{" "}
          {num(ex.richVsTerse.picks[1].cpLoss / 100, 0)} pawns. The rich description of rook takes
          e5 says it loses material in the exchange (−2); the terse one only says it captures a
          knight.
        </Position>
      </Section>
      <Divider />

      <Section id="q5" eyebrow="Question 5" title="What does SemIf's tournament cost?">
        <Prose>
          SemIf can rank at most 16 moves at a time, and {pct(CONTEXT.over16, 0)} of these positions
          have more. So SemIf runs a knockout: heats of up to 16 moves, then a final. Jev takes up
          to 255 moves and never needs one. Two measurements separate the tournament from the model:
        </Prose>
        <ul className="flex list-disc flex-col gap-space-1 pl-space-5 text-sm text-secondary">
          <li>
            <M>finalist_recall</M>: in tournament positions, did Stockfish's best move survive the
            heats?
          </li>
          <li>
            The capped Jev run forces the same knockout onto Jev. Comparing it with plain Jev shows
            what the tournament alone costs, on the same model.
          </li>
        </ul>
        <DataTable
          head={[
            "Run",
            "Top-1, ≤16 legal",
            "Top-1, >16 legal",
            "Best move survived the heats",
            "Requests per ranking",
          ]}
          rows={RUNS.map((run) => [
            run.label,
            pct(r(run.key).top1Single),
            pct(r(run.key).top1Tournament),
            pct(r(run.key).finalistRecall),
            num(r(run.key).requests, 2),
          ])}
        />
        <Answer>
          SemIf's heats knock Stockfish's best move out in {pct(knockedOut, 0)} of tournament
          positions, which helps explain why SemIf drops from {pct(r("semif-rich").top1Single)} to{" "}
          {pct(r("semif-rich").top1Tournament)} when there are more than 16 moves. But the
          tournament itself isn't the problem: forced through the same knockout, Jev keeps{" "}
          {pct(r("jev-rich-cap16").finalistRecall, 0)} of best moves and scores{" "}
          {pct(r("jev-rich-cap16").top1)}, the same as uncapped ({pct(r("jev-rich").top1)}). The
          knockout costs a second, sequential request ({num(r("jev-rich-cap16").requests, 2)} per
          ranking instead of 1), not accuracy.
        </Answer>
        <Position ex={ex.knockout} title="Knocked out in the heats">
          {ex.knockout.legal} legal moves, so SemIf runs a tournament. Knight to c3, Stockfish's
          best, is eliminated in the heats, and SemIf's final picks a3 (Stockfish's{" "}
          {ordinal(ex.knockout.picks[0].moves[0].engineRank)}). Jev sees all {ex.knockout.legal}{" "}
          moves at once and ranks knight to c3 first.
        </Position>
      </Section>
      <Divider />

      <Section id="q6" eyebrow="Question 6" title="Can the gate trust System 1's confidence?">
        <Prose>
          The gate lets System 1 play alone when its margin clears a threshold (
          {PRODUCTION_THRESHOLD} by default). A useful threshold keeps a meaningful share of moves (
          <B>kept</B>) and is right on most of them (<B>right</B>). Higher thresholds keep fewer
          moves; they should be right more often.
        </Prose>
        <DataTable
          head={[
            "Run",
            ...THRESHOLDS.map((t) => (t === PRODUCTION_THRESHOLD ? `≥ ${t} (default)` : `≥ ${t}`)),
          ]}
          rows={RUNS.map((run) => [
            run.label,
            ...THRESHOLDS.map((t) => {
              const { kept, right } = gate(run.key, t);
              const small = kept * r(run.key).n < SMALL_SAMPLE;
              return `${pct(kept)} · ${small ? `(${pct(right, 0)})` : pct(right, 0)}`;
            }),
          ])}
          note={`Each cell: share of moves kept · how often the kept move is the engine's best. Accuracy in brackets rests on fewer than ${SMALL_SAMPLE} kept positions, so it's unreliable.`}
        />
        <Answer>
          At the production threshold of {PRODUCTION_THRESHOLD}, SemIf rich plays{" "}
          {pct(gate("semif-rich", PRODUCTION_THRESHOLD).kept)} of moves alone but is right only{" "}
          {pct(gate("semif-rich", PRODUCTION_THRESHOLD).right)} of the time. Jev rich plays half as
          many ({pct(gate("jev-rich", PRODUCTION_THRESHOLD).kept)}) and is right{" "}
          {pct(gate("jev-rich", PRODUCTION_THRESHOLD).right)} of the time. SemIf is overconfident,
          partly because of the tournament: its confidence is only over the finalists, even when the
          best move was knocked out. Terse descriptions make both models almost never confident.
        </Answer>
        <Position ex={ex.gateRight} title="Confident and right">
          SemIf is <B>{pct(ex.gateRight.picks[0].moves[0].probability)}</B> sure of knight takes e5,
          recapturing the pawn White just took, and it's right: every alternative loses at least 2.5
          pawns. This is the gate at its best.
        </Position>
        <Position ex={ex.gateWrong} title="Confident and wrong">
          SemIf is <B>{pct(ex.gateWrong.picks[0].moves[0].probability)}</B> sure of queen takes f4
          (margin <B>{ex.gateWrong.picks[0].margin.toFixed(2)}</B>), so the gate would let it play.
          But queen to b5, Stockfish's best, was knocked out in the heats, and queen takes f4 gives
          up {num(ex.gateWrong.picks[0].cpLoss / 100, 1)} pawns. The margin only compares the
          finalists.
        </Position>
      </Section>
      <Divider />

      <Section
        id="q7"
        eyebrow="Question 7"
        title="Does it depend on the players' level or the phase of the game?"
      >
        <Prose>
          Top-1 accuracy split by the rating of the player to move, and by game phase. Each band has
          400 positions and each phase about 667, so these numbers are noisier: about ±4 points for
          bands and ±3 for phases.
        </Prose>
        <DataTable
          head={["Group", ...RUNS.map((run) => run.label)]}
          rows={[
            ...BANDS.map((b) => [b, ...RUNS.map((run) => pct(r(run.key).bands[b]))]),
            ...PHASES.map((p) => [capitalize(p), ...RUNS.map((run) => pct(r(run.key).phases[p]))]),
          ]}
          highlight={(i) => i >= BANDS.length}
        />
        <Answer>
          The order holds in every band and phase: a Jev rich run leads and the terse runs trail.
          Accuracy dips for the 2000-2399 band and in openings on every run. The rest of the metrics
          under the same splits are in each experiment's summary feedback in LangSmith.
        </Answer>
      </Section>
      <Divider />

      <Section
        id="q8"
        eyebrow="Question 8"
        title="Does System 1 play like a human or like an engine?"
      >
        <Prose>
          <M>human_match@1</M> is how often System 1's top pick is the move the human actually
          played. Humans played Stockfish's best in {pct(CONTEXT.humansBest)} of these positions.
        </Prose>
        <DataTable
          head={["Run", "Matches Stockfish", "Matches the human"]}
          rows={RUNS.map((run) => [run.label, pct(r(run.key).top1), pct(r(run.key).humanMatch)])}
        />
        <Answer>
          About as often as it matches Stockfish: within{" "}
          {num(
            Math.max(...RUNS.map((run) => Math.abs(r(run.key).humanMatch - r(run.key).top1))) * 100,
            1,
          )}{" "}
          points on every run. System 1 is neither a human imitator nor an engine: it picks moves
          that are plausible to both.
        </Answer>
      </Section>
      <Divider />

      <Section id="next" eyebrow="Takeaways" title="What to do with this">
        <ul className="flex list-disc flex-col gap-space-2 pl-space-5 text-sm text-secondary">
          <li>
            <B>Keep rich descriptions.</B> They're the cheapest lever here: 7 to 8 points of top-1
            accuracy and 40 to 55% less centipawn loss, for about 35% more input tokens.
          </li>
          <li>
            <B>Tune the gate per model.</B> {PRODUCTION_THRESHOLD} lets SemIf play{" "}
            {pct(gate("semif-rich", PRODUCTION_THRESHOLD).kept, 0)} of moves at{" "}
            {pct(gate("semif-rich", PRODUCTION_THRESHOLD).right, 0)} accuracy. For SemIf, a higher
            threshold or a separate tournament threshold (the middleware supports one) is worth
            testing. For Jev, {PRODUCTION_THRESHOLD} is conservative: 0.8 doubles the moves it plays
            alone ({pct(gate("jev-rich", "0.8").kept, 0)}) at{" "}
            {pct(gate("jev-rich", "0.8").right, 0)} accuracy, still above SemIf at{" "}
            {PRODUCTION_THRESHOLD}.
          </li>
          <li>
            <B>SemIf's weakness is the model, not the tournament.</B> Improving the heats won't
            close the gap to Jev; the capped Jev run shows the knockout costs almost nothing on a
            stronger ranker.
          </li>
          <li>
            <B>Next measurements:</B> the tactical puzzle split, gate thresholds against game
            results, and repeated runs to put error bars on the gaps.
          </li>
        </ul>
      </Section>

      <Section id="method" eyebrow="Method" title="How this was measured">
        <ul className="flex list-disc flex-col gap-space-1 pl-space-5 text-sm text-secondary">
          <li>
            Dataset {DATASET.name}@{DATASET.version}, full split: {num(CONTEXT.positions)} positions
            from lichess_db_standard_rated_2018-06, seed 7, labelled by Stockfish 19 at depth 16
            with one line per legal move. See <M>evals/datasets/positions/v1.manifest.json</M>.
          </li>
          <li>
            Each run ranks every position once with GatewayRanker, as SystemOneMiddleware would,
            with max_concurrency 4. Rate-limited requests retry for up to 2 minutes. No ranking
            failed.
          </li>
          <li>
            Averages are plain means over the stratified set: every rating band and phase weighs the
            same.
          </li>
          <li>
            Experiments ran at commit <M>{CONTEXT.gitSha}</M>. This page is a snapshot of their
            results on 2026-09-26; the data above was copied from them when it was written.
          </li>
        </ul>
      </Section>
    </ReportPage>
  );
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
