import type { ExerciseConfig } from "../../types/motion.js";
import type { JointSessionStat, SessionSummary } from "../scoring/SessionRecorder.js";
import type { ChatMessage } from "./LLMClient.js";

export type CoachPersona = "biomech" | "baduanjin";

export const FOLLOWUP_MAX_ROUNDS = 4;
export const FOLLOWUP_MAX_HISTORY_CHARS = 4000;
export const FOLLOWUP_MAX_QUESTION_CHARS = 500;

const PERSONA_SUFFIX: Record<CoachPersona, string> = {
  biomech: "Persona：严谨的运动生物力学专家。引用一处具体肌肉或关节力学因果（如 \"臀中肌力量不足\"、\"髂腰肌过紧\"、\"足弓塌陷\"）。",
  baduanjin: "Persona：传统八段锦传人。引用\"势\"与\"经络\"（如\"调息不畅\"、\"足太阳膀胱经未通\"），但仍给出可量化训练建议。",
};

const SYSTEM_PROMPT_BASE = `你是 KINE//X 的运动复盘教练，针对用户刚完成的一段标准动作给出诊断。
输出规则（违反任一条视为失败）：
1. 仅输出诊断正文，120 字以内，单段，无标题、无序号、无 emoji、无 markdown。
2. 全句陈述肯定语气；禁止以"可能 / 或许 / 建议你"开头。
3. 提到关节误差必须带数字 + 单位 (° / 厘米 / %)。
4. 必须点名一处具体的生物力学因果或传统功理。
5. 最后一句给出一个可执行训练动作（一个动作 + 时长或次数）。
6. 全程中文，不夹英文。`;

const FOLLOWUP_PERSONA_SUFFIX: Record<CoachPersona, string> = {
  biomech: "以运动生物力学专家的口吻解释；明确区分测量数据、合理推断与无法确认的信息。",
  baduanjin: "以传统八段锦教练的口吻解释；可以使用势、呼吸与经络语汇，但必须同时联系可量化的动作数据，不能把传统功理表述为医学结论。",
};

const FOLLOWUP_SYSTEM_PROMPT_BASE = `你是 KINE//X 的运动复盘教练，正在回答用户对刚完成训练的后续追问。
回答规则：
1. 直接回答当前问题，使用自然、简洁的中文；不再受首轮诊断的 120 字、单段和固定结尾限制。
2. 只能依据提供的训练数据、首轮诊断和对话历史回答；不得声称看到了未提供的视频、图片或逐帧动作。
3. 明确区分可测量事实与生物力学推断。原因无法由现有数据确认时，必须说明仍需从正面或侧面画面进一步确认。
4. 不作疾病或损伤诊断。用户描述疼痛、麻木、眩晕或受伤时，要求立即停止训练并寻求专业医疗评估。
5. 只有用户询问改进方法、训练计划或下一步动作时，才给出带次数或时长的可执行练习；不要在每次回答末尾强行追加训练动作。
6. 不重复整份首轮报告，优先解释用户正在追问的具体指标或关节。`;

export function buildDiagnosisMessages(
  exercise: ExerciseConfig,
  session: SessionSummary,
  persona: CoachPersona,
): ChatMessage[] {
  const payload = compactPayload(exercise, session);
  const system = `${SYSTEM_PROMPT_BASE}\n${PERSONA_SUFFIX[persona]}`;
  const user = `基于以下会话数据给出诊断：\n${JSON.stringify(payload)}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function buildFollowupMessages(
  exercise: ExerciseConfig,
  session: SessionSummary,
  persona: CoachPersona,
  diagnosisText: string,
  history: ChatMessage[],
  question: string,
): ChatMessage[] {
  const payload = compactPayload(exercise, session);
  const system = `${FOLLOWUP_SYSTEM_PROMPT_BASE}\n${FOLLOWUP_PERSONA_SUFFIX[persona]}`;
  const context =
    "以下是本次训练的固定上下文，仅用于回答追问：\n" +
    JSON.stringify(payload);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: context },
  ];
  const diagnosis = diagnosisText.trim();
  if (diagnosis) {
    messages.push({ role: "assistant", content: `首轮诊断：${diagnosis}` });
  }
  messages.push(...limitFollowupHistory(history));
  messages.push({
    role: "user",
    content: question.trim().slice(0, FOLLOWUP_MAX_QUESTION_CHARS),
  });
  return messages;
}

export function limitFollowupHistory(history: ChatMessage[]): ChatMessage[] {
  const rounds: Array<[ChatMessage, ChatMessage]> = [];
  for (let index = 0; index + 1 < history.length; index += 2) {
    const user = history[index];
    const assistant = history[index + 1];
    if (user?.role !== "user" || assistant?.role !== "assistant") continue;
    if (!user.content.trim() || !assistant.content.trim()) continue;
    rounds.push([user, assistant]);
  }

  const recent = rounds.slice(-FOLLOWUP_MAX_ROUNDS);
  const kept: Array<[ChatMessage, ChatMessage]> = [];
  let used = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const round = recent[index];
    if (!round) continue;
    const cost = round[0].content.length + round[1].content.length;
    if (used + cost > FOLLOWUP_MAX_HISTORY_CHARS) {
      if (kept.length === 0) kept.push(truncateRound(round, FOLLOWUP_MAX_HISTORY_CHARS));
      break;
    }
    kept.push(round);
    used += cost;
  }
  return kept.reverse().flatMap((round) => round);
}

function truncateRound(
  round: [ChatMessage, ChatMessage],
  budget: number,
): [ChatMessage, ChatMessage] {
  const userBudget = Math.min(round[0].content.length, Math.max(1, Math.floor(budget * 0.35)));
  const assistantBudget = Math.max(1, budget - userBudget);
  return [
    { role: "user", content: round[0].content.slice(0, userBudget) },
    { role: "assistant", content: round[1].content.slice(0, assistantBudget) },
  ];
}

export function buildFallbackText(exercise: ExerciseConfig, session: SessionSummary): string {
  const worst = session.joints[0];
  const avg = Math.round(session.avgScore);
  const phaseLabel = phaseToLabel(session.worstPhase);
  if (!worst) {
    return `本次 ${exercise.name} 综合匹配度 ${avg}%，未捕捉到显著偏差。维持当前节奏，继续巩固核心控制。下一组练习前完成 30 秒平板支撑作为预激活。`;
  }
  const delta = worst.worstAngleDeltaDeg.toFixed(1);
  const at = Math.round(worst.worstAtProgress * 100);
  return `本次 ${exercise.name} 综合匹配度 ${avg}%，${worst.name} 在动作 ${at}% 进度时偏差 ${delta}°，集中出现在${phaseLabel}阶段。这通常由相邻肌群激活不足造成。下一组练习前做 2 × 20 次靠墙静蹲 ${worst.id === "knee" || worst.id === "hip" ? "稳定膝髋" : "重建核心张力"}。`;
}

interface CompactPayload {
  exercise: { id: string; name: string; discipline: string; motion: string; durationSeconds: number };
  session: {
    frames: number;
    durationSeconds: number;
    avgScore: number;
    worstFrameScore: number;
    worstPhase: string;
    phaseAvgScores: Record<string, number>;
  };
  joints: Array<{
    id: string;
    name: string;
    avgScore: number;
    worstScore: number;
    worstAngleDeltaDeg: number;
    worstDistanceDeltaCm: number;
    worstAtProgress: number;
    riskHits: number;
  }>;
}

function compactPayload(exercise: ExerciseConfig, session: SessionSummary): CompactPayload {
  return {
    exercise: {
      id: exercise.id,
      name: exercise.name,
      discipline: exercise.discipline,
      motion: exercise.motion,
      durationSeconds: round2(exercise.durationSeconds),
    },
    session: {
      frames: session.frames,
      durationSeconds: round2(session.durationSeconds),
      avgScore: round1(session.avgScore),
      worstFrameScore: round1(session.worstFrameScore),
      worstPhase: session.worstPhase,
      phaseAvgScores: {
        intro: round1(session.phaseAvgScores.intro),
        mid: round1(session.phaseAvgScores.mid),
        peak: round1(session.phaseAvgScores.peak),
        outro: round1(session.phaseAvgScores.outro),
      },
    },
    joints: session.joints.slice(0, 5).map((j: JointSessionStat) => ({
      id: j.id,
      name: j.name,
      avgScore: round1(j.avgScore),
      worstScore: round1(j.worstScore),
      worstAngleDeltaDeg: round1(j.worstAngleDeltaDeg),
      worstDistanceDeltaCm: round1(j.worstDistanceDeltaCm),
      worstAtProgress: round2(j.worstAtProgress),
      riskHits: j.riskHits,
    })),
  };
}

function phaseToLabel(phase: string): string {
  switch (phase) {
    case "intro":
      return "起势";
    case "mid":
      return "下行";
    case "peak":
      return "底点";
    case "outro":
      return "收势";
    default:
      return "全段";
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
