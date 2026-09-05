// Everything the renderer needs to draw one workout over the self-hosted
// basemap: the worker, the archive, the style and the three overlays.
//
// This is the only file that imports maplibre, and nothing imports it except
// the lazy route map. Reaching this module is what pulls the renderer down, so
// an instance with no archive installed never asks for a byte of it.
//
// The map reaches outside this origin for nothing at all: the tiles, the
// lettering and the symbols are files served by our own nginx.

import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps'
// v6 has no default export, and its Map would shadow the language's own.
import {
  addProtocol,
  MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type StyleSpecification,
} from 'maplibre-gl'
// The tiles are parsed in a worker that ships as its own module file, found by
// a path the bundler cannot see. Vite is asked for the built worker's URL here
// so it is emitted and served from our own origin.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'

import type { Theme } from '../theme'
import { ASSETS, TILES } from './basemap'
import { alongRoute, spotAt, spotsBetween, type Spot } from './route'

import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(workerUrl)

// One archive, read in slivers by byte range, so the browser never downloads a
// file that size. Registering the protocol is global to maplibre and happens
// once, when this chunk arrives.
addProtocol('pmtiles', new Protocol().tile)

// Written out in full because maplibre refuses a relative sprite URL, and our
// own origin is the only one these can ever name. One sheet of symbols per
// ground, the same keys in both; the lettering is shared.
const GLYPHS = `${location.origin}${ASSETS}/fonts/{fontstack}/{range}.pbf`
const SPRITES = `${location.origin}${ASSETS}/sprites`

// The tiles are OpenStreetMap under ODbL, which asks for the credit. It is the
// only fine print on the screen, and it stays folded into the compact control
// until somebody opens it.
const CREDIT =
  '<a href="https://github.com/protomaps/basemaps" target="_blank" rel="noreferrer">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

// Every colour the map is painted in, kept in step with index.css by hand: a
// style is JSON and cannot read a custom property. The first six are the app's
// own tokens; the rest are the map's alone, chosen off them so a map in a card
// reads as part of the card rather than as a window cut into it.
const INK: Record<Theme, Record<string, string>> = {
  dark: {
    bg: '#101312',
    surface: '#171b19',
    surface2: '#1d2220',
    accent: '#8fc7a0',
    orange: '#efa25a',
    muted: '#94a89b',
    water: '#1a2a36',
    greenA: '#142019',
    greenB: '#17261d',
    buildings: '#0c0f0e',
    roadLow: '#1e2422',
    roadMid: '#28322d',
    roadHigh: '#334038',
    quiet: '#5c6f63',
    label: '#7d9186',
  },
  light: {
    bg: '#f7f4ec',
    surface: '#fffdf7',
    surface2: '#f1ede2',
    accent: '#35684f',
    orange: '#9c5512',
    muted: '#56705f',
    water: '#cfdfe9',
    greenA: '#e6ece3',
    greenB: '#d8e5d8',
    buildings: '#e9e4d8',
    roadLow: '#e6e1d6',
    roadMid: '#d6d0c2',
    roadHigh: '#c6bfaf',
    quiet: '#9aa89e',
    label: '#7b8f82',
  },
}

// The stock flavour with the app's palette laid over it. Only colour is
// changed: which layers exist, which fonts they are set in and what the points
// of interest are coloured are the flavour's business and are left alone.
export function flavorFor(theme: Theme): Flavor {
  const ink = INK[theme]
  return {
    ...namedFlavor(theme),
    background: ink.bg,
    earth: ink.bg,

    // Growing things, muted toward the app's green. Two shades because the
    // flavour draws these in two bands.
    park_a: ink.greenA,
    park_b: ink.greenB,
    wood_a: ink.greenA,
    wood_b: ink.greenB,
    scrub_a: ink.greenA,
    scrub_b: ink.greenB,
    zoo: ink.greenA,

    // Ground that is neither green nor road: a card's raised surface, so it
    // reads as a change of material rather than a colour of its own.
    hospital: ink.surface2,
    industrial: ink.surface2,
    school: ink.surface2,
    pedestrian: ink.surface2,
    glacier: ink.surface2,
    sand: ink.surface2,
    beach: ink.surface2,
    aerodrome: ink.surface2,
    military: ink.surface2,

    water: ink.water,
    buildings: ink.buildings,

    // The road ladder: quietest for a service road, brightest for a highway,
    // so the shape of a town still comes through three tones.
    other: ink.roadLow,
    minor_service: ink.roadLow,
    minor_b: ink.roadLow,
    pier: ink.roadLow,
    tunnel_other: ink.roadLow,
    tunnel_minor: ink.roadLow,
    tunnel_link: ink.roadLow,
    tunnel_major: ink.roadLow,
    tunnel_highway: ink.roadLow,
    bridges_other: ink.roadLow,
    bridges_minor: ink.roadLow,
    minor_a: ink.roadMid,
    link: ink.roadMid,
    major: ink.roadMid,
    runway: ink.roadMid,
    bridges_link: ink.roadMid,
    bridges_major: ink.roadMid,
    highway: ink.roadHigh,
    bridges_highway: ink.roadHigh,

    // Every casing is the ground itself, which is what separates one road from
    // the next without drawing a second colour around all of them.
    tunnel_other_casing: ink.bg,
    tunnel_minor_casing: ink.bg,
    tunnel_link_casing: ink.bg,
    tunnel_major_casing: ink.bg,
    tunnel_highway_casing: ink.bg,
    minor_service_casing: ink.bg,
    minor_casing: ink.bg,
    link_casing: ink.bg,
    major_casing_early: ink.bg,
    major_casing_late: ink.bg,
    highway_casing_early: ink.bg,
    highway_casing_late: ink.bg,
    bridges_other_casing: ink.bg,
    bridges_minor_casing: ink.bg,
    bridges_link_casing: ink.bg,
    bridges_major_casing: ink.bg,
    bridges_highway_casing: ink.bg,

    railway: ink.quiet,
    boundaries: ink.quiet,

    // Lettering in the app's own quiet greens, each one haloed in the ground
    // so a name over a road is still a name.
    roads_label_minor: ink.label,
    roads_label_minor_halo: ink.bg,
    roads_label_major: ink.muted,
    roads_label_major_halo: ink.bg,
    ocean_label: ink.label,
    subplace_label: ink.label,
    subplace_label_halo: ink.bg,
    city_label: ink.muted,
    city_label_halo: ink.bg,
    state_label: ink.quiet,
    state_label_halo: ink.bg,
    country_label: ink.label,
    address_label: ink.label,
    address_label_halo: ink.bg,

    landcover: {
      forest: ink.greenB,
      grassland: ink.greenB,
      farmland: ink.greenA,
      scrub: ink.greenA,
      urban_area: ink.surface2,
      barren: ink.surface2,
      glacier: ink.surface2,
    },
  }
}

// The server sends latitude first and maplibre wants longitude first.
const flipped = (points: [number, number][]): Spot[] =>
  points.map(([lat, lon]): Spot => [lon, lat])

const NOTHING = { type: 'FeatureCollection' as const, features: [] }

// The corners the map opens on: everything the route covers and nothing else.
export function corners(points: [number, number][]): LngLatBoundsLike {
  const lats = points.map(([lat]) => lat)
  const lons = points.map(([, lon]) => lon)
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}

const lineOf = (spots: Spot[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: spots },
})

// The stretch a tapped split covers, as two shares of the way along the line.
// The same arithmetic the drawing uses, over longitude and latitude instead of
// a box on the page.
function trailData(points: [number, number][], span: { from: number; to: number } | null) {
  if (span === null) return NOTHING
  const spots = spotsBetween(flipped(points), alongRoute(points), span.from, span.to)
  return spots.length < 2 ? NOTHING : lineOf(spots)
}

// Where the graph's cursor has reached, as one point on the line.
function markData(points: [number, number][], part: number | null) {
  const spot = part === null ? null : spotAt(flipped(points), alongRoute(points), part)
  if (spot === null) return NOTHING
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Point' as const, coordinates: spot },
  }
}

// The whole map in one object: the basemap, and the three overlays over it.
// The overlays live in the style rather than being added on load, so changing
// the ground under the map is one setStyle and nothing has to be put back.
export function styleFor(theme: Theme, points: [number, number][]): StyleSpecification {
  const ink = INK[theme]
  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: `${SPRITES}/${theme}`,
    sources: {
      protomaps: { type: 'vector', url: `pmtiles://${TILES}`, attribution: CREDIT },
      route: { type: 'geojson', data: lineOf(flipped(points)) },
      trail: { type: 'geojson', data: NOTHING },
      mark: { type: 'geojson', data: NOTHING },
    },
    layers: [
      // Cast because the flavour's layers are typed against its own copy of
      // the style spec, which is the same shape under a different name.
      ...(layers('protomaps', flavorFor(theme), { lang: 'en' }) as StyleSpecification['layers']),
      {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ink.accent, 'line-width': 3 },
      },
      // The tapped split, laid over the route in the card's own colour first
      // so it reads as laid on rather than mixed in.
      {
        id: 'trail-edge',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ink.surface, 'line-width': 7 },
      },
      {
        id: 'trail',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ink.orange, 'line-width': 4 },
      },
      {
        id: 'mark-edge',
        type: 'circle',
        source: 'mark',
        paint: { 'circle-radius': 7.5, 'circle-color': ink.surface },
      },
      {
        id: 'mark',
        type: 'circle',
        source: 'mark',
        paint: { 'circle-radius': 5.5, 'circle-color': ink.orange },
      },
    ],
  }
}

// Both setters ask for the source rather than assuming it: a style being
// swapped for the other ground has none for a moment, and a cursor moving
// through that moment should do nothing rather than throw.
function feed(
  map: MapLibreMap,
  name: string,
  data: Parameters<GeoJSONSource['setData']>[0]
): void {
  const source = map.getSource(name) as GeoJSONSource | undefined
  source?.setData(data)
}

export function setTrail(
  map: MapLibreMap,
  points: [number, number][],
  span: { from: number; to: number } | null
): void {
  feed(map, 'trail', trailData(points, span))
}

export function setMark(
  map: MapLibreMap,
  points: [number, number][],
  part: number | null
): void {
  feed(map, 'mark', markData(points, part))
}

export { MapLibreMap }
