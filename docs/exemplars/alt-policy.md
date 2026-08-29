# Image alt text: the policy as we practice it

**Audience:** instructional designers and faculty authoring interactives in this tool.
**Status:** current practice, 2026-08-28. One page on purpose.

## The only question that matters first

Before you write a word of alt text, answer one question about the image:

> **If this image were deleted, would the learner lose information they need?**

- **No** — the image is *decorative*. It sets a mood, fills a header band, repeats something the text already says.
- **Yes** — the image is *informative*. It carries meaning: a diagram, a chart, a photograph of a situation the question is about, a document the learner has to read.

There is no third answer. If you cannot decide, treat it as informative and describe it.

## What each answer requires

| | Decorative | Informative |
| --- | --- | --- |
| Alt text | `alt=""` (empty, deliberately) | A human-authored sentence |
| Who signs off | Nobody — the empty alt *is* the decision | A named human accepts the text as its author |
| What screen readers do | Skip it silently | Read your sentence in place of the image |
| Schema behavior | `imageRole: "decorative"` and **no** `imageAlt` (the schema rejects alt text on a decorative image) | `imageRole: "informative"` and a **non-empty** `imageAlt` (the schema rejects an empty one) |

The branching-scenario schema enforces both halves of that last row: an image without a role fails validation, an informative image without alt text fails validation, and a decorative image *with* alt text fails validation. This is deliberate. The most common accessibility defect in course content is not a missing description; it is an image nobody ever classified, which then gets a filename read aloud.

## Writing an informative alt

- **One sentence, usually.** Say what the image conveys, not what it is made of. "A balance with its two pans at unequal heights" beats "a JPEG image of scales."
- **Lead with the content, not the container.** Do not start with "Image of" or "Picture showing" — the screen reader already announced that it is an image.
- **Describe the point the image is making in this lesson.** The same photograph in a nursing course and a photography course needs different alt text. Alt is contextual, not intrinsic.
- **If the image contains text, the alt contains that text.** Every word of it, or the text moves into the page body where everyone can read it.
- **Charts and data images:** the alt gives the takeaway ("Concentration falls by half every four hours"), and the underlying numbers go in the body or a table. Alt text is not a data dump.
- **Length:** the field caps at 300 characters. If you need more than that, the image is doing work that belongs in the body text.

## The human-acceptance step

Some images in this library were drafted by an agent, and so were their first drafts of alt text. **A drafted alt is a proposal, not a description.** Before an interactive is delivered, a named human reads the image and the proposed sentence together and either accepts it or rewrites it. For the exemplar library that human is Tamara (EdPlus), acting as author of record.

"Author of record" means exactly what it sounds like: the accepted sentence is *hers*, and the accessibility claim the package makes rests on a person having looked at the image. An agent cannot accept its own draft, because the whole value of the step is that a second party who can actually see the image confirms the description is true.

In practice this is three lines in a review email:

1. Here is the image (attached or linked).
2. Here is the proposed alt text.
3. Accept as written / accept with this edit / this image should be decorative instead.

Record the acceptance where the exemplar's brief lives (`docs/exemplars/brief-<slug>.md`, section 8), so the next person to touch the package can see the alt text was accepted rather than generated.

## Where images can appear today

- **Branching scenarios:** one image per scene, with `imageRole` and `imageAlt` as above.
- **Parameter sandboxes:** background and overlay images in a visual scene. These are editor-only uploads; the companion-doc text format has no grammar for them by design.

Committed starter templates ship **image-less**. Assets are per-project uploads, so a starter carrying an asset id would point at an asset the new project does not have. Designers adapting a starter upload their own image, which is the intended flow — the exemplar briefs note where a header image goes and what it should show.

## Known seam: AI-suggested alt (future)

Nothing in this tool suggests alt text today. When it does, the suggestion enters at the same place a drafted alt enters now: as a proposal in the editor field, pre-filled but unaccepted, with the human acceptance step unchanged. The policy does not loosen because the draft got faster. Two things will need to be true before that seam ships: the suggestion must be visibly marked as unaccepted in the editor, and export must be able to tell an accepted alt from an unreviewed one. Until then, every non-empty `imageAlt` in this repository is a sentence a person read and agreed to.
