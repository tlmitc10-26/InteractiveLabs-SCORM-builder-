import { caseConfigSchema, type CaseConfig } from "./schema";

/**
 * Starter templates offered on the "New interactive" form for the case
 * workspace engine. Each entry's `config` is parsed through
 * `caseConfigSchema` at module load time so an invalid starter fails
 * immediately (a test asserts this — see tests/case-starters.test.ts)
 * rather than surfacing as a runtime bug the first time someone picks it.
 * `caseConfigSchema.parse` runs the full validateCaseConfig-independent
 * shape/field-level checks; the starters test additionally runs every
 * starter through `validateCaseConfig` to also cover the cross-field rules
 * (map resolution, per-conclusion requirements, mode gate) that
 * `.parse` alone does not.
 *
 * `config.title` here is a placeholder ("") — the real title always comes
 * from the "New interactive" form, never from the starter. Callers should
 * go through `caseStarterConfig(starterId, title)` below rather than
 * reading `CASE_STARTERS[id].config` directly, so the title is always the
 * one the designer actually typed.
 */
export const CASE_STARTERS: Record<string, { label: string; description: string; group: "blank" | "exemplar"; config: CaseConfig }> = {
  blank: {
    label: "Blank",
    description:
      "Two artifacts, two conclusions, and a minimal expert map, scored best-supported — a skeleton to build your own case workspace from.",
    group: "blank",
    config: caseConfigSchema.parse({
      title: "",
      intro:
        "<p>Review the artifacts below, build a case file of the evidence you find relevant, and commit to the conclusion you can best defend with sound reasoning.</p>",
      scoringMode: "best-supported",
      artifacts: [
        {
          id: "artifact_one",
          title: "Artifact One",
          kind: "text",
          body: "<p>Describe the first piece of evidence here — a memo, a log excerpt, a witness statement. Give the learner enough detail to weigh it against each conclusion.</p>",
        },
        {
          id: "artifact_two",
          title: "Artifact Two",
          kind: "text",
          body: "<p>Describe a second piece of evidence here. An artifact can support a conclusion, contradict it, or be entirely irrelevant — irrelevant artifacts are a legitimate part of the exercise.</p>",
        },
      ],
      conclusions: [
        {
          id: "conclusion_a",
          label: "Conclusion A",
          credit: "full",
          expertRationale: "<p>Explain, from the expert's point of view, why this is the best-supported conclusion given the artifacts above.</p>",
          reasons: [
            {
              id: "conclusion_a_sound",
              text: "A sound reason that genuinely follows from the evidence for Conclusion A.",
              sound: true,
            },
            {
              id: "conclusion_a_flawed",
              text: "A plausible-sounding but flawed reason for Conclusion A.",
              sound: false,
              flawNote: "Explain the reasoning flaw here — this note appears to the learner after they select this reason.",
            },
          ],
        },
        {
          id: "conclusion_b",
          label: "Conclusion B",
          credit: "none",
          expertRationale: "<p>Explain why this conclusion falls short, even though it may look reasonable at first glance.</p>",
          reasons: [
            {
              id: "conclusion_b_sound",
              text: "A sound reason relevant to Conclusion B, even though it isn't the credited conclusion.",
              sound: true,
            },
            {
              id: "conclusion_b_flawed",
              text: "A flawed reason relevant to Conclusion B.",
              sound: false,
              flawNote: "Explain the reasoning flaw here.",
            },
          ],
        },
      ],
      expertMap: [
        { artifactId: "artifact_one", conclusionId: "conclusion_a", role: "supports", strength: "strong" },
        { artifactId: "artifact_two", conclusionId: "conclusion_b", role: "supports", strength: "weak" },
      ],
    }),
  },
  /**
   * "The Ladder Incident" (case-workspace M3, exemplar library): transcribed
   * verbatim from `parseCaseCompanionDoc(docs/exemplars/ladder-incident.companion.txt).config`
   * — zero invention, see docs/exemplars/brief-ladder-incident.md. The
   * committed companion doc is the source of truth; tests/exemplar-
   * content.test.ts asserts this config stays structurally equal to that
   * doc's parse result. The ONE deliberate divergence is `title`: this
   * module's placeholder-title invariant (see the file header) wins, so the
   * title stays "" here while the committed doc carries the real,
   * faculty-facing TITLE ("The Ladder Incident", carried in `label` below).
   */
  "ladder-incident": {
    label: "The Ladder Incident",
    description: "Evidence weighing with an expert map — best-supported conclusion, mixed evidence, and a red herring the score never rewards.",
    group: "exemplar",
    config: caseConfigSchema.parse({
      title: "",
      intro:
        "<p>Just after nine in the morning on 12 February 2026, an inventory associate at Corvale Fulfillment's Building 4 fell from a stepladder in the returns aisle and was seriously hurt. You have been assigned the investigation. Corvale Fulfillment, its employees and every document here are fictional, and this is a teaching case about how investigators reason from evidence rather than guidance for any real incident. Read the artifacts, add the ones you find probative to your case file, and commit to the conclusion you can defend. By the end you will be able to distinguish the condition that caused an incident from the conditions that merely contributed to it, and to say what a given record does and does not establish. Three explanations are on offer and the evidence is genuinely mixed. One of them is better supported than the others, and finding out which one takes reading the records closely rather than quickly.</p>",
      scoringMode: "best-supported",
      artifacts: [
        {
          "id": "incident_report",
          "title": "Incident report",
          "sourceLine": "Corvale Fulfillment incident report NF-2026-018, filed by E. Farhadi, shift supervisor",
          "kind": "text",
          "body": "<p>At approximately 09:20 on 12 February 2026, inventory associate Marisol Quintero fell from a portable stepladder in Aisle 12 of Building 4 while retrieving a returns tote from the third rack level. Quintero was working a standard eight-hour shift, her second shift back after four scheduled days off. She was found on the floor by order picker Jinhee Park, treated on site, and transported. Recorded injuries are a fractured left wrist and a concussion.</p><p>The ladder is an eight-foot aluminum stepladder, asset tag L-14, rated at 300 pounds. It was found lying on its right side with the rear left rail separated from the top cap. Quintero's weight together with the tote is recorded as 214 pounds. The tote was found on the floor about five feet to the left of the ladder's base. The base itself had not moved from the position marked by the floor tape.</p><p>Farhadi did not witness the fall and reached Aisle 12 roughly ninety seconds afterward. Quintero has given no statement: she has no recollection of the minute before the fall, which the treating clinician attributed to the head injury. The ladder was tagged, impounded the same day, and released to an outside laboratory for examination.</p>"
        },
        {
          "id": "ladder_examination_report",
          "title": "Ladder examination report",
          "sourceLine": "Vantage Materials Testing report VMT-4471, examination of asset L-14, 3 March 2026",
          "kind": "text",
          "body": "<p>The ladder arrived sealed and was examined as received. The rear left rail is separated from the top cap at the upper rivet hole. The separation runs through the rail wall from the rivet hole to the outer edge, a distance of about one and one quarter inches.</p><p>Under magnification the fracture surface has two distinct regions. About seventy percent of the surface, measured outward from the rivet hole, is discolored and oxidized and carries beach markings consistent with a crack that grew progressively under repeated loading, arresting and restarting over an extended period. The remaining thirty percent is bright, clean and free of oxidation, consistent with final separation at the time of the incident. The oxidized region cannot have formed at the moment of failure.</p><p>The rail material meets specification and the fracture shows no manufacturing defect. The recorded load of 214 pounds is well inside the ladder's 300 pound rating; with seventy percent of the rail section already cracked, the remaining section would separate under loads far below that rating.</p><p>A hairline separation at the rail-to-cap joint would have been visible on close examination of that joint, which is item six of the manufacturer's inspection checklist. It would not be visible from the floor or from the front of the ladder.</p>"
        },
        {
          "id": "witness_statement",
          "title": "Witness statement",
          "sourceLine": "Statement of Jinhee Park, order picker, taken 12 February 2026",
          "kind": "text",
          "body": "<p>I was pulling from Aisle 14, two aisles over. I heard a crack, like a pallet board going, and then a second later the ladder and Marisol coming down. I did not see her fall. By the time I came around the end cap she was already on the floor.</p><p>Marisol moves fast. Everybody on returns moves fast, it is how the shift gets cleared. I saw her stand on the top cap of a different ladder back in the summer and I said something to her about it. I do not know what she was doing this time.</p><p>Nobody uses those ladders except returns. I could not tell you the last time I saw anyone look one over.</p>"
        },
        {
          "id": "ladder_inspection_log",
          "title": "Ladder inspection log",
          "sourceLine": "Corvale Fulfillment facilities inspection log, Building 4, extract",
          "kind": "table",
          "table": {
            "caption": "Monthly portable ladder inspections recorded for the Building 4 returns area",
            "headers": ["Date", "Asset tag", "Inspector", "Result"],
            "rows": [
              ["2025-09-04", "L-14", "C. Boyd", "Pass"],
              ["2025-10-02", "L-14", "C. Boyd", "Pass"],
              ["2025-11-06", "L-12", "C. Boyd", "Pass"],
              ["2025-12-04", "L-12", "C. Boyd", "Pass"],
              ["2026-01-08", "L-12", "C. Boyd", "Pass"],
              ["2026-02-05", "L-12", "C. Boyd", "Pass"]
            ]
          }
        },
        {
          "id": "training_records",
          "title": "Training records",
          "sourceLine": "Corvale Fulfillment learning management system extract, Building 4",
          "kind": "table",
          "table": {
            "caption": "Safety training on file for the employees named in this case",
            "headers": ["Employee", "Course", "Completed", "Score"],
            "rows": [
              ["M. Quintero", "Portable ladder safety", "2025-11-18", "92 percent"],
              ["M. Quintero", "Fall hazard awareness", "2025-06-03", "88 percent"],
              ["C. Boyd", "Portable ladder inspection", "2025-08-21", "95 percent"],
              ["C. Boyd", "Lockout and tagout", "2025-04-14", "90 percent"],
              ["J. Park", "Portable ladder safety", "2025-11-18", "84 percent"]
            ]
          }
        },
        {
          "id": "ladder_safety_procedure",
          "title": "Ladder safety procedure",
          "sourceLine": "Corvale Fulfillment SOP 4.12, Portable Ladder Safety, revision 5, effective 1 July 2024",
          "kind": "text",
          "body": "<p>4.1 Scope. This procedure applies to every portable stepladder and extension ladder at a Corvale Fulfillment site and to every employee who uses one.</p><p>4.2 Pre-use inspection. Before each use the user shall inspect the ladder for cracked, bent or missing parts, including the rails, steps, spreaders, feet and the rail-to-cap joints. A ladder with any crack or deformation shall be red-tagged, removed from service immediately, and reported to facilities within the same shift.</p><p>4.3 Documented inspection. Facilities shall inspect every portable ladder at least monthly, record each inspection against the ladder's asset tag, and retain the record for three years.</p><p>4.4 Use. Users shall maintain three points of contact, shall not stand above the second step from the top, and shall not reach beyond the side rails. Move the ladder rather than reaching from it.</p>"
        },
        {
          "id": "peak_season_overtime_notice",
          "title": "Peak season overtime notice",
          "sourceLine": "Building 4 all-staff notice, posted 27 October 2025",
          "kind": "text",
          "body": "<p>Beginning 1 November, Building 4 runs ten-hour shifts Monday through Thursday for the peak returns season. Ten-hour shifts are voluntary for associates in returns and inventory control and mandatory for outbound. Associates who do not opt in stay on the standard eight-hour schedule.</p><p>The facilities and maintenance team stays on its existing schedule. Questions to your shift supervisor or to Tanya Okonkwo, EHS manager.</p>"
        }
      ],
      conclusions: [
        {
          "id": "the_employee_s_own_actions_cause",
          "label": "The employee's own actions caused the fall",
          "credit": "partial",
          "expertRationale": "<p>This conclusion is defensible on the record, and it is not the best-supported one. A tote five feet to the left of a ladder base that never moved is real evidence of a reach past the side rail, and reaching past the rails is the specific act SOP 4.12 prohibits. An investigator who got this far is reasoning from evidence rather than from assumption.</p><p>What moves it out of first place is the examination report. A rail cracked through seventy percent of its section separates under loads far below the ladder's rating, so the fall is fully explained without any departure from procedure, while a reach on its own does not explain the fracture surface at all. The reach, if it happened, changed when a cracked rail let go rather than whether it would. Investigations that stop at the person nearest the injury are the most common failure mode in this work, and they are common precisely because there is usually some evidence for them.</p>",
          "reasons": [
            { "id": "the_tote_was_found_five_feet_to", "text": "The tote was found five feet to the left of a ladder base that had not moved, which is consistent with a reach past the side rail.", "sound": true },
            { "id": "sop_4_12_prohibits_reaching_beyo", "text": "SOP 4.12 prohibits reaching beyond the side rails, and Quintero was current on that training.", "sound": true },
            { "id": "park_says_quintero_always_moves", "text": "Park says Quintero always moves fast and once stood on the top cap of another ladder, so she was probably careless this time as well.", "sound": false, "flawNote": "Character reasoning. A colleague's impression of how someone generally works, plus one unrelated incident months earlier, is not evidence about what this person did on this ladder on this morning." },
            { "id": "she_was_reaching_to_her_left_whe", "text": "She was reaching to her left when the ladder went over, and the reach is therefore what brought her down.", "sound": false, "flawNote": "Coincidence taken for cause. Two things that happen in the same instant are not thereby cause and effect. The rail separated in that same instant, and the examination shows it would have separated under a load well inside the rating." }
          ]
        },
        {
          "id": "the_ladder_failed_structurally",
          "label": "The ladder failed structurally",
          "credit": "full",
          "expertRationale": "<p>The physical evidence settles the mechanism. About seventy percent of the fracture face was oxidized before the day of the fall, which means the rail was already cracked through most of its section while the ladder stayed in service, and the load at separation was well inside the ladder's rating. A defect that had been growing for months, on a unit whose last recorded inspection was more than four months old, is the explanation that accounts for every artifact in the file rather than only some of them.</p><p>Naming the ladder as the cause is not the same as saying nothing else went wrong. The inspection log shows a control that was written down and then not performed on this unit, and a reach past the side rail may well have been the loading that finished a rail already cracked. An investigator ranks these. The defect is the condition without which the fall does not happen; the rest are contributing factors. That ranking is what makes the corrective action a ladder inspection and removal program rather than a conversation with one associate.</p>",
          "reasons": [
            { "id": "about_seventy_percent_of_the_fra", "text": "About seventy percent of the fracture face is oxidized, so the crack was open and growing well before the morning of the fall.", "sound": true },
            { "id": "the_rail_separated_at_a_load_of", "text": "The rail separated at a load of 214 pounds against a 300 pound rating, so the failure is not explained by how much weight was on the ladder.", "sound": true },
            { "id": "the_log_records_no_inspection_of", "text": "The log records no inspection of L-14 in the four months before the fall, so a crack at the rail-to-cap joint had time to grow unseen.", "sound": true },
            { "id": "nothing_in_the_file_records_the", "text": "Nothing in the file records the ladder as sound on the morning of the fall, and that silence is itself proof the ladder was defective.", "sound": false, "flawNote": "Treats an absence of evidence as evidence. The examination establishes the defect; a gap in the paperwork establishes nothing on its own, and the same move would condemn any ladder with an incomplete file." },
            { "id": "the_examination_shows_that_this", "text": "The examination shows that this ladder was unsafe from the day it left the factory, and every unit from that batch should be pulled.", "sound": false, "flawNote": "Overreach. The report finds a fatigue crack that grew over an extended period and expressly finds no manufacturing defect, which is a claim about this unit's recent service life, not about its condition when new." }
          ]
        },
        {
          "id": "the_site_s_written_training_and",
          "label": "The site's written training and procedures were inadequate",
          "credit": "none",
          "expertRationale": "<p>The instinct behind this conclusion is a good one and the evidence does not carry it. SOP 4.12 is specific about the exact failure mode in this case: it requires inspection of the rail-to-cap joints, immediate red-tagging of any crack, and a documented monthly inspection recorded against the asset tag. The training records show the associate current on ladder safety and the technician current on ladder inspection.</p><p>The log does show a real defect in execution, four consecutive months recorded against L-12 while L-14 was left out, and an investigator is entitled to weigh that. But a procedure that was written correctly and then not performed on one unit is a compliance failure rather than an inadequate procedure, and the two findings generate different corrective actions. Calling this one inadequate training would send the site off to rewrite documents that already say the right thing.</p>",
          "reasons": [
            { "id": "the_log_records_four_consecutive", "text": "The log records four consecutive monthly inspections against L-12 and none against L-14, so a control the procedure requires was not performed on this ladder.", "sound": true },
            { "id": "every_inspection_in_the_extract", "text": "Every inspection in the extract was performed and recorded by the same technician with no second check, so a unit left out had no way of being caught.", "sound": true },
            { "id": "an_associate_was_seriously_hurt", "text": "An associate was seriously hurt on a routine task, so the site's safety program was not adequate.", "sound": false, "flawNote": "Overreach from an outcome to a system. How badly someone is hurt is a function of height and landing, not of program quality, and reasoning backward from harm condemns every program that ever has an incident." },
            { "id": "the_inspection_gap_starts_in_nov", "text": "The inspection gap starts in November, the month Building 4 went to ten-hour shifts, so the peak season schedule is what degraded the program.", "sound": false, "flawNote": "Post hoc. The notice itself says facilities and maintenance stayed on their existing schedule, so the two facts only share a month. A date that lines up is a reason to look, not a finding." }
          ]
        }
      ],
      expertMap: [
        { "artifactId": "incident_report", "conclusionId": "the_employee_s_own_actions_cause", "role": "supports", "strength": "weak" },
        { "artifactId": "ladder_safety_procedure", "conclusionId": "the_employee_s_own_actions_cause", "role": "supports", "strength": "weak" },
        { "artifactId": "ladder_examination_report", "conclusionId": "the_employee_s_own_actions_cause", "role": "contradicts", "strength": "strong" },
        { "artifactId": "ladder_examination_report", "conclusionId": "the_ladder_failed_structurally", "role": "supports", "strength": "strong" },
        { "artifactId": "incident_report", "conclusionId": "the_ladder_failed_structurally", "role": "supports", "strength": "weak" },
        { "artifactId": "witness_statement", "conclusionId": "the_ladder_failed_structurally", "role": "supports", "strength": "weak" },
        { "artifactId": "ladder_inspection_log", "conclusionId": "the_ladder_failed_structurally", "role": "supports", "strength": "weak" },
        { "artifactId": "ladder_inspection_log", "conclusionId": "the_site_s_written_training_and", "role": "supports", "strength": "weak" },
        { "artifactId": "witness_statement", "conclusionId": "the_site_s_written_training_and", "role": "supports", "strength": "weak" },
        { "artifactId": "training_records", "conclusionId": "the_site_s_written_training_and", "role": "contradicts", "strength": "strong" },
        { "artifactId": "ladder_safety_procedure", "conclusionId": "the_site_s_written_training_and", "role": "contradicts", "strength": "strong" }
      ],
    }),
  },
};

export const DEFAULT_CASE_STARTER_ID = "blank";

/** Builds a fresh, title-stamped config for the given starter id. Unknown
 *  ids fall back to the blank starter (mirrors branching's
 *  branchingStarterConfig) rather than throwing, since this can be reached
 *  with attacker-controlled input. Re-parses through the schema so the
 *  result is a genuinely fresh object tree (no shared references back into
 *  `CASE_STARTERS`), not just a shallow spread. */
export function caseStarterConfig(starterId: string, title: string): CaseConfig {
  const starter = CASE_STARTERS[starterId] ?? CASE_STARTERS[DEFAULT_CASE_STARTER_ID];
  return caseConfigSchema.parse({ ...starter.config, title });
}
