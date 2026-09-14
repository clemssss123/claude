/**
 * Importing this module registers every built-in effect. Adding an effect
 * means adding a file and one import line here — the engine itself does not
 * change.
 */
import './blur';
import './color';
import './stylize';
import './distort';
import './generate';
import './keying';
import './noise';
import './transition';
import './time';
import './shake';

export * from './registry';
