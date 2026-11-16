# The Brass Atlas

An illuminated field atlas laid on a midnight teal campaign table: engraved terrain,
painted wooden company pieces, warm ivory paper and restrained antique brass.
Every mark is composed locally with vectors, CSS and a stateless seeded hash.
No images, font downloads, network assets or simulation randomness are used.

**Palette & material.** Deep teal `#172e30` grounds the interface; ivory `#fff2d4`
is the reading surface, brass `#c4a15d` marks focus and objectives. Blue teal shields
identify allies, vermilion diamonds identify enemies. Dotted blue movement borders,
crossed attack corners and hatched danger areas remain distinct without colour.
Paper has fine grain; stone has cut faces and a lower shadow; cover has clustered
trees and contour rings. Walls are the only raised, impassable terrain. No decorative
height or weather implies a rule the kernel does not support. Status hazards use
named badges and an hourglass ring, never invented map penalties.

**Shape & identity.** Tokens have a bevel, shadow, faction pennant and medallion
portrait. Identity seeds select skin and hair; class seeds select four headgear
silhouettes, three mantle cuts, five crests and three trim materials. Weapon glyphs
show sword, axe, lance, bow or tome independently of class. HP has a segmented
ivory bar and number. A check mark plus subdued material marks spent actions.
The same portrait recipe appears on the board and inspection card.

**Type & hierarchy.** Local system Georgia for chapter titles, large editorial
headlines and numerals; Segoe UI/system sans for controls and rules. Small uppercase
eyebrows and fine rules recall atlas marginalia. Generous dark space surrounds the
board; compact ivory cards carry detailed readings. Settings and provider forms
share the same materials and focus treatment. Technical details live in disclosures.

**Motion.** Pieces follow costed cardinal paths with cubic easing (90–420 ms).
Attacks use a directional sweep, hit ripple, brief recoil, rising damage and a
fading defeated piece. Critical strikes receive a larger brass burst; misses show
MISS. Abilities use expanding temporal rings. Enemy actions remain sequential at
the chosen playback speed and may be skipped. Phase ribbons announce ownership.
Ambient glints are slow and sparse. Reduced motion, including the OS preference,
removes travel, recoil, fading, floating movement and ambient motion, while retaining
static, timed feedback and sequential enemy summaries. Motion never delays commits
or changes rules, saves, random draws, targeting or Turnwheel.

**Living maps and generated pieces.** Generated battles use the same paper, ink and
brass on boards of any size; the camera fits small fields and clamps large ones (drag to
pan, wheel to zoom). Terrain keeps its engraved looks (`grass forest water wall rock sand
road floor crop fence lava…`) and generated tiles pick a look or draw their own. Pieces
are faction-shaped bevelled tokens (shield, diamond, hex, circle, square, triangle) with a
medallion holding a procedural body plan — humanoid, beast, bird, serpent, blob, construct,
machine, spirit, plant or swarm — coloured from the content's sprite spec. Modules may
replace any of this with their own vector drawing; style stays flat fills, thin ink
outlines and restrained colour. Every custom mechanic gives visible feedback: floating
labels, rings and status pips on the board, plus a log line.

**Sound.** All audio is synthesized live with WebAudio — no recordings, no files, no
network. The palette is dry and woody with brass highlights: soft triangle clicks for UI,
filtered-noise footfalls, a low sine thump plus noise for hits, an airy whoosh for misses,
a bright bell cluster for criticals, falling tones for defeats, rising thirds for buffs,
minor falls for debuffs, and short brass-like fanfares or low drones for victory and
defeat. Music is generative and adaptive: a pentatonic pad and plucked arpeggio for
conversation, a darker minor mode with bass for tense scenes, added drums and a faster
pulse in battle, and a harsher "danger" layer when the player's side is losing; moods
crossfade over a bar. Generated content can add or override cues and moods. Master,
music and effects volume plus mute persist; *calm audio* (following the reduced-motion
preference by default) drops percussion and softens transients. Identical cues within
40 ms merge, and huge enemy phases are capped to a few sounds per step.

**Budget & access.** Terrain geometry is cached until seed or terrain changes;
hover redraws only highlights. A single capped Pixi ticker moves existing objects.
No per-frame React updates or textures are generated. The board scales to viewport
height; forms and sidebars scroll at small sizes. All controls are keyboard reachable,
focus is visible, board navigation remains WASD/arrows, and factions/states use shape
and text in addition to colour.
