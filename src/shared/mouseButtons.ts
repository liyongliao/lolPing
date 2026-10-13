export type MarkerButton = 'left' | 'right';
export type ButtonScope = MarkerButton | 'both';
export type RoomButtonScope = ButtonScope | 'none';
export const markerButton = (raw: unknown): MarkerButton => raw === 'right' ? 'right' : 'left';
export const scopeAllows = (scope: RoomButtonScope, button: MarkerButton): boolean => scope === 'both' || scope === button;
