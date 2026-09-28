/**
 * The seven surfaces of direction B (tokens.css layer 2, globals.css
 * `[data-tone]`). A band picks one; everything on it takes its colours.
 */
export type Tone = 'sand' | 'paper' | 'aub' | 'night' | 'deep' | 'coral' | 'saffron'

/** An edge is drawn in the colour of the band it opens, so it takes a tone. */
export type EdgeColor = Tone
