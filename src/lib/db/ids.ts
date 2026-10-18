/**
 * ids + time helpers.
 * row ids are prefixed so an id in a log tells you what it points at.
 */
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function rand(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${rand(8)}`;
}

export const newLeadId = () => id("lead");
export const newCompanyId = () => id("co");
export const newMemberId = () => id("mem");
export const newSourceId = () => id("src");
export const newCampaignId = () => id("cmp");
export const newMessageId = () => id("msg");
export const newTaskId = () => id("task");
export const newEventId = () => id("evt");
export const newJobId = () => id("job");
export const newMeetingId = () => id("mtg");
export const newOppId = () => id("opp");
export const newSequenceId = () => id("seq");
export const newEnrollmentId = () => id("enr");
export const newStepId = () => id("step");
export const newFormId = () => id("form");
export const newImportId = () => id("imp");
export const newRuleId = () => id("rule");
export const newFieldId = () => id("cf");
export const newMergeId = () => id("mrg");
export const newDupeId = () => id("dup");
export const newLinkId = () => id("lnk");
export const newRunId = () => id("run");
export const newLogId = () => id("log");
export const newProspectSearchId = () => id("psr");
export const newProspectCandidateId = () => id("prc");
export const newWorkspaceId = () => id("ws");
export const newSessionId = () => id("ses");