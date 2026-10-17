// Map looks that belong to LeafIt instead of default Google: the satellite view without shop/business pins (they compete
// with the area you're drawing), and a street map in the app's charcoal-green palette. Raster styles, no Map ID needed.

const labels = [
  { elementType: 'labels.text.fill', stylers: [{ color: '#E8EDE3' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#141815' }, { weight: 3 }] },
];

export const SATELLITE_STYLE = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  ...labels,
];

export const STREET_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1B201C' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  ...labels,
  { elementType: 'labels.text.fill', stylers: [{ color: '#8C9589' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2E362F' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#C9D1C4' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#203222' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#202621' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2A312B' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#141815' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3B4A35' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#B8C7AE' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0E1A1F' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4E6B78' }] },
];

// Light theme street map: Google's own light cartography, minus the business pins and transit clutter.
export const STREET_STYLE_LIGHT = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
];
