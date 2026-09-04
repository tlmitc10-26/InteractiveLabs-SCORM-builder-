import { processConfigSchema, type ProcessConfig } from "./schema";

/**
 * Starter templates offered on the "New interactive" form for the process
 * simulator engine. Each entry's `config` is parsed through
 * `processConfigSchema` at module load time so an invalid starter fails
 * immediately (a test asserts this — see tests/process-starters.test.ts)
 * rather than surfacing as a runtime bug the first time someone picks it.
 * `processConfigSchema.parse` runs the shape/field-level checks; the
 * starters test additionally runs every starter through
 * `validateProcessConfig` to also cover the cross-field rules (acyclicity,
 * requires-only-required, the illegally-attemptable hard rule, the field
 * matrix, unique required labels) that `.parse` alone does not.
 *
 * `config.title` here is a placeholder ("") — the real title always comes
 * from the "New interactive" form, never from the starter. Callers should
 * go through `processStarterConfig(starterId, title)` below rather than
 * reading `PROCESS_STARTERS[id].config` directly, so the title is always
 * the one the designer actually typed.
 */
export const PROCESS_STARTERS: Record<string, { label: string; description: string; group: "blank" | "exemplar"; config: ProcessConfig }> = {
  blank: {
    label: "Blank",
    description:
      "A minimal, already-gradeable procedure: one prerequisite edge and one distractor, satisfying the schema's illegally-attemptable rule out of the box — build your own procedure from here.",
    group: "blank",
    config: processConfigSchema.parse({
      title: "",
      intro:
        "<p>Read the situation, then perform each action in an order that respects its prerequisites. A wrong or premature action produces a realistic consequence and lets you continue — mistakes cost score, never the attempt.</p>",
      opening: "<p>Describe the initial situation the learner walks into here — enough detail to make the first action obvious.</p>",
      actions: [
        {
          id: "first_action",
          label: "Describe the first action here",
          required: true,
          outcome: "<p>Describe what becomes true in the situation once this action is legally performed.</p>",
        },
        {
          id: "second_action",
          label: "Describe a second gated action here",
          required: true,
          requires: ["first_action"],
          outcome: "<p>Describe what becomes true once this action is legally performed.</p>",
          consequence: "<p>Describe the realistic consequence of attempting this action before its prerequisite is done.</p>",
          consequenceNote: "Explain, for the debrief, why the prerequisite matters.",
        },
        {
          id: "third_action",
          label: "Describe a third independent required action here",
          required: true,
          outcome: "<p>Describe what becomes true once this action is legally performed.</p>",
        },
        {
          id: "distractor_action",
          label: "Describe a tempting but wrong action here",
          required: false,
          consequence: "<p>Describe the realistic consequence of taking this wrong action.</p>",
          consequenceNote: "Explain, for the debrief, why this action is never correct.",
        },
      ],
    }),
  },
  /**
   * Evidence Intake (M3, docs/exemplars/brief-evidence-intake.md): a
   * prerequisite-graph procedure with realistic consequences — chain of
   * custody for a single item of physical evidence. Authored THROUGH the
   * process companion-doc format: the committed doc
   * (docs/exemplars/evidence-intake.companion.txt) is the source of truth,
   * and this config is a verbatim transcription of
   * parseProcessCompanionDoc(doc).config, title normalized to the
   * placeholder "" per this file's own convention (see the module doc
   * comment above) — the doc itself carries the real, faculty-facing TITLE.
   * tests/exemplar-content.test.ts locks the parity between the two, plus
   * the witness/flawless/messy scoring fixtures and the no-giveaway gates
   * from the brief's §6.
   */
  "evidence-intake": {
    label: "Evidence Intake",
    description:
      "Prerequisite-graph procedure with realistic consequences — chain of custody for a single item of physical evidence, with genuine order flexibility at the top of the graph (photograph/sketch and gloves are unordered) and a strict documentation-before-disturbance/continuous-custody chain once collection happens.",
    group: "exemplar",
    config: processConfigSchema.parse({
      title: "",
      intro:
        "<p>A rear door at the Cottonmill Veterinary Clinic was pried open overnight, and the tool used on it is still lying inside the doorway. Your job this morning is to bring that one item back to the Ashmoor County evidence room with a record complete enough to be read months from now by someone who was never at the scene. Ashmoor County, its sheriff's office, its evidence manual and everyone named here are fictional. What follows is one fictional agency's standard operating procedure, written to teach the reasoning behind evidence handling; it is not a standard, and the policy of the agency you work for governs how you actually do this work. By the end of this exercise you will be able to sequence an evidence intake so that every step that destroys information happens after the step that records it, and to say what each link in a chain of custody is actually protecting. A wrong or premature action produces a realistic consequence and lets you continue — mistakes cost score, never the attempt. More than one order is correct here. Work the procedure in an order you can defend, and read what each action does to the scene before you choose the next one.</p>",
      opening:
        "<p>It is 06:40 on a Tuesday. Deputy Ruben Alcavero has met you at the clinic's rear door, which was forced at the latch and stands half open, and a cash box is missing from the front desk. A flat steel pry bar is lying on the tile about a foot inside the doorway. Nadia Oyelaran, the clinic's office manager, opened up this morning, found the door and called it in; she is waiting in the parking lot with two staff members, and a delivery van has just pulled up to the same door. Nothing has been moved. The bar is yours to bring in.</p>",
      expertNote:
        "<p>The expert path is not a single order. Two things have to be true before the bar moves: the scene is under control, and the bar's position exists somewhere other than in your memory. Photographs and a measured sketch are two independent records of the same undisturbed scene, so whichever you take first is a matter of light and preference rather than procedure. Gloves are the same kind of choice - any time before you touch the bar is the right time. After the bar is in the bag the order stops being flexible, because from there each step is what gives the next one its meaning: a seal only reports on itself if your initials cross it, a label is only findable if the log carries the same number, and a handoff is only continuous if the entry exists before the package leaves your hands.</p>",
      actions: [
        {
          id: "secure_the_scene_and_control_who",
          label: "Secure the scene and control who enters it",
          required: true,
          outcome:
            "<p>Deputy Alcavero takes the parking lot side and turns the delivery driver back to the street. The clinic staff move around to the front of the building, and one deputy starts a log of everyone who crosses the tape. The scene stops changing while you work in it.</p>",
        },
        {
          id: "put_on_a_fresh_pair_of_examinati",
          label: "Put on a fresh pair of examination gloves",
          required: true,
          outcome:
            "<p>You glove up from the box in your kit rather than reusing the pair in your jacket pocket. Whatever is on the bar stays on the bar, and nothing of yours joins it.</p>",
        },
        {
          id: "photograph_the_item_where_it_lie",
          label: "Photograph the item where it lies",
          required: true,
          requires: ["secure_the_scene_and_control_who"],
          outcome:
            "<p>Four frames: the doorway from inside the corridor, the bar in relation to the forced latch, a close-up of the bar without a scale, and the same close-up again with a scale card beside it. The bar's position now exists in something other than your memory.</p>",
          consequence:
            "<p>You are photographing a scene that is still open. Behind you the delivery driver has stepped through the doorway to see what happened, and the frames you just shot record a room that has already had two extra people in it. Whether they show the doorway as it was left overnight is now a question nobody can answer.</p>",
          consequenceNote:
            "A photograph of an uncontrolled scene records the scene at the moment the shutter opened and nothing earlier than that.",
        },
        {
          id: "sketch_the_room_and_measure_the",
          label: "Sketch the room and measure the item's position",
          required: true,
          requires: ["secure_the_scene_and_control_who"],
          outcome:
            "<p>You draw the corridor, the rear door and the front desk, then fix the bar with two measurements: fourteen inches from the door jamb and thirty-one inches from the north wall. The sketch carries the case number, the date, your name and a north arrow.</p>",
          consequence:
            "<p>You are measuring to a doorway people are still walking through. One of your reference points is a door somebody has since pushed further open, so the numbers on the sketch describe a room that no longer matches the one in the report, and nothing on the page says which version it was.</p>",
          consequenceNote:
            "A measurement is only as good as the scene it was taken in. Control the access first, then fix the item to something that will still be there tomorrow.",
        },
        {
          id: "collect_the_item_and_place_it_in",
          label: "Collect the item and place it in an evidence bag",
          required: true,
          requires: [
            "put_on_a_fresh_pair_of_examinati",
            "photograph_the_item_where_it_lie",
            "sketch_the_room_and_measure_the",
          ],
          outcome:
            "<p>You lift the bar by its flat faces, keeping clear of the pry end, and set it into a paper evidence bag large enough that nothing has to be forced, padding the pry end so it cannot shift or puncture the bag in transit. The bag goes on the clean side of your kit and never on the floor.</p>",
          consequence:
            "<p>The bar comes up before the scene has finished being recorded. Whatever was still missing - the photographs, the measurements, or clean gloves between your hand and the steel - cannot be supplied afterward, because the only thing that could have supplied it was the bar lying where you found it.</p>",
          consequenceNote:
            "Collection is the one step that cannot be undone. Everything that documents the item where it was found has to exist before the item moves.",
        },
        {
          id: "seal_the_evidence_bag_with_tampe",
          label: "Seal the evidence bag with tamper-evident tape",
          required: true,
          requires: ["collect_the_item_and_place_it_in"],
          outcome:
            "<p>You fold the mouth of the bag over twice and run tamper-evident tape the full width of the fold, pressing it down until no edge lifts. The package is now closed in a way that shows whether it has been opened.</p>",
          consequence:
            "<p>There is nothing in the bag to seal. A sealed empty bag is not a package, it is one more object at the scene that you will have to account for later, and the bar is still on the tile where you left it.</p>",
          consequenceNote:
            "A seal is an act performed on a filled bag. Its whole value is that it was applied once, at collection, and has not been disturbed since.",
        },
        {
          id: "label_the_sealed_bag_and_initial",
          label: "Label the sealed bag and initial across the seal",
          required: true,
          requires: ["seal_the_evidence_bag_with_tampe"],
          outcome:
            "<p>You write the case number, the item number, the date and time, the recovery location and your name on the face of the bag, then initial and date across the tape so that each mark runs onto the paper on both sides of it.</p>",
          consequence:
            "<p>You are writing on a bag that is still open. Initials that do not cross a seal record only that you were holding a pen, because the whole purpose of the mark is that it cannot survive the tape being lifted and put back.</p>",
          consequenceNote:
            "The initials belong to the seal, not to the label. They only do their work when they run across the tape and onto the bag on both sides.",
        },
        {
          id: "record_the_item_on_the_agency_ev",
          label: "Record the item on the agency evidence log",
          required: true,
          requires: ["label_the_sealed_bag_and_initial"],
          outcome:
            "<p>You enter the case number, item one, a short description of the bar and its approximate length, the recovery location, the date and time of collection and your name. The entry matches the face of the bag word for word.</p>",
          consequence:
            "<p>You are logging a package that carries no number yet. The entry you make now describes an item you will have to identify all over again when you finally label the bag, and the two records can only agree by luck.</p>",
          consequenceNote:
            "The log and the label are one record kept in two places. Write the label first and copy it across, and the two of them cannot disagree.",
        },
        {
          id: "transfer_the_sealed_package_to_t",
          label: "Transfer the sealed package to the evidence custodian",
          required: true,
          requires: ["record_the_item_on_the_agency_ev"],
          outcome:
            "<p>You carry the bag to the evidence room and hand it to custodian Hana Yamashiro, who checks the seal against the label. You both sign the transfer line, and she gives you the receipt copy. Custody has changed hands once, on paper, with both of you standing there.</p>",
          consequence:
            "<p>You are handing over a package the log does not know about. From the moment it leaves your hands with no entry behind it, the only account of where it has been since the clinic is your recollection, and the custodian has nothing to sign against.</p>",
          consequenceNote:
            "A transfer is a documented event. If the log entry does not exist first, the handoff was not recorded, it was only remembered.",
        },
        {
          id: "move_the_item_into_better_light",
          label: "Move the item into better light before photographing it",
          required: false,
          consequence:
            "<p>You slide the bar a foot toward the doorway and the frames come out much better. They are also frames of a position you created. The measurements you take next will describe where you put the bar, and no later photograph can put it back: the relationship between the bar, the jamb and the pry marks existed once, and you have just spent it.</p>",
          consequenceNote:
            "A clear photograph of the wrong position is worth less than a poor photograph of the right one. Light is a problem to solve with a flash rather than with your hands.",
        },
        {
          id: "hand_the_item_to_the_reporting_p",
          label: "Hand the item to the reporting party to hold",
          required: false,
          consequence:
            "<p>Nadia Oyelaran takes the bar willingly and holds it while you finish the sketch. She is now a person who has handled the item, and she is not in your log, not in your photographs and not wearing gloves. Everything that follows has an unrecorded pair of hands in the middle of it.</p>",
          consequenceNote:
            "Every person who touches the item belongs in the record. The quickest way to open a gap in it is to accept help.",
        },
        {
          id: "seal_the_bag_with_office_tape_fr",
          label: "Seal the bag with office tape from the drawer",
          required: false,
          consequence:
            "<p>The clinic's front desk has a tape dispenser and the bag closes neatly. Office tape lifts off a paper bag and goes back down leaving nothing behind, so the package now looks closed while being unable to say whether it stayed that way. The seal is the only part of the package that reports on itself.</p>",
          consequenceNote:
            "Tamper-evident tape is not stationery with a case number written on it. The point of it is the damage it does when somebody takes it off.",
        },
        {
          id: "fill_in_the_evidence_log_at_shif",
          label: "Fill in the evidence log at shift end",
          required: false,
          consequence:
            "<p>The bag goes in the front seat and you plan to write it up with the rest of the paperwork at seven. For the next several hours the only record of where the item has been is your memory, and the times you eventually write down will be the times you remember rather than the times that happened.</p>",
          consequenceNote:
            "The log is a contemporaneous record. Written afterward it becomes a reconstruction, and everyone who reads it later has to take your word for the gap.",
        },
      ],
    }),
  },
};

export const DEFAULT_PROCESS_STARTER_ID = "blank";

/** Builds a fresh, title-stamped config for the given starter id. Unknown
 *  ids fall back to the blank starter (mirrors case-workspace's
 *  caseStarterConfig / branching's branchingStarterConfig) rather than
 *  throwing, since this can be reached with attacker-controlled input.
 *  Re-parses through the schema so the result is a genuinely fresh object
 *  tree (no shared references back into `PROCESS_STARTERS`), not just a
 *  shallow spread. */
export function processStarterConfig(starterId: string, title: string): ProcessConfig {
  const starter = PROCESS_STARTERS[starterId] ?? PROCESS_STARTERS[DEFAULT_PROCESS_STARTER_ID];
  return processConfigSchema.parse({ ...starter.config, title });
}
