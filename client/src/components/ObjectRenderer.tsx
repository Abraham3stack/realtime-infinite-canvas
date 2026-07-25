import React from 'react';
import { CanvasObject, CanvasObjectType } from '../store/objects.js';
import { RectangleShape } from './shapes/RectangleShape.js';
import { CircleShape } from './shapes/CircleShape.js';
import { TextShape } from './shapes/TextShape.js';
import { StickyNoteShape } from './shapes/StickyNoteShape.js';
import { ImageShape } from './shapes/ImageShape.js';
import { AudioShape } from './shapes/AudioShape.js';
import { VideoShape } from './shapes/VideoShape.js';

interface ObjectRendererProps {
  object: CanvasObject;
  selected: boolean;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
}

// Factory mapping: object type -> React component
// This avoids large switch statements and makes adding new types straightforward.
// To add a new type: (1) create shape component, (2) register in this map.
const shapeComponentMap: Record<
  CanvasObjectType,
  React.ComponentType<ObjectRendererProps>
> = {
  rectangle: RectangleShape,
  circle: CircleShape,
  text: TextShape,
  'sticky-note': StickyNoteShape,
  image: ImageShape,
  audio: AudioShape,
  video: VideoShape,
};

/**
 * ObjectRenderer: Maps canvas objects to their corresponding Konva shape components.
 * Uses factory pattern to decouple object types from rendering logic.
 * Extensible: new types added by registering component in shapeComponentMap.
 */
export const ObjectRenderer: React.FC<ObjectRendererProps> = ({
  object,
  selected,
  onMove,
  onResize,
  onDelete,
}) => {
  const Component = shapeComponentMap[object.type];

  if (!Component) {
    console.warn(`Unknown object type: ${object.type}`);
    return null;
  }

  return <Component object={object} selected={selected} onMove={onMove} onResize={onResize} onDelete={onDelete} />;
};
