// Shaped exactly like the API's own responses, so a test that passes here is
// testing the real contract. Shared rather than copied per file: the copies had
// already drifted apart once.

/** A thread whose board and section share a name, with a character on the opening post. */
export const MAD_INVESTOR = {
  id: 4582,
  subject: 'mad investor chaos and the woman of asmodeus',
  description: 'some dath ilani are more Chaotic than others, but',
  num_replies: 4482,
  board: { id: 215, name: 'planecrash' },
  section: { id: 703, name: 'planecrash' },
  authors: [{ username: 'Iarwain' }, { username: 'lintamande' }],
  character: { id: 11729, name: 'Keltham', screenname: 'lawful chaotic' },
  icon: { keyword: 'brooding 1' },
  content: '<p>Keltham is having a <em>very</em> strange day.</p>',
};

/** The thread tests/fixtures/thread-page.html was cut from. */
export const NEW_NEIGHBORS = {
  id: 100,
  subject: 'New neighbors. Just as frustrating.',
  description: 'Mountain and Elves',
  num_replies: 369,
  board: { id: 3, name: 'Sandboxes' },
  section: null,
  authors: [{ username: 'lintamande' }, { username: 'Rockeye' }],
  character: { id: 588, name: 'Mountain' },
  icon: { keyword: 'confusion' },
  content: '<p>She does not feel any tiles.</p>',
};

/** A reply with no character — an author narrating, which the API reports as nulls. */
export const NARRATION = {
  id: 1,
  character_name: null,
  character: null,
  icon: { keyword: 'Celegorm' },
  user: { username: 'lintamande' },
  content: "<p>She's on an ocean.</p>",
};
