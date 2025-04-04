// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the map with a default location
    const map = L.map('map').setView([51.505, -0.09], 13);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Initialize FeatureGroup for drawn items
    let drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Initialize drawing control
    const drawControl = new L.Control.Draw({
        draw: {
            polygon: {
                shapeOptions: {
                    color: '#3388ff',
                    weight: 2
                },
                allowIntersection: false,
                drawError: {
                    color: '#e1e100',
                    timeout: 1000
                },
                showArea: true
            },
            rectangle: {
                shapeOptions: {
                    color: '#3388ff',
                    weight: 2
                },
                showArea: true
            },
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });
    map.addControl(drawControl);

    // Store markers and detected entities
    let markers = new L.FeatureGroup();
    map.addLayer(markers);

    // Store the search marker separately
    let searchMarker = null;

    // Function to search for a location
    function searchLocation() {
        const searchInput = document.getElementById('location-search').value;
        if (!searchInput) {
            alert('Please enter a location to search');
            return;
        }

        // Show loading state
        const searchButton = document.querySelector('button[onclick="searchLocation()"]');
        const originalButtonText = searchButton.innerHTML;
        searchButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';
        searchButton.disabled = true;

        fetch('/search_location', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: searchInput
            })
        })
        .then(response => response.json())
        .then(data => {
            // Reset button state
            searchButton.innerHTML = originalButtonText;
            searchButton.disabled = false;

            if (data.success) {
                // Remove existing search marker if it exists
                if (searchMarker) {
                    map.removeLayer(searchMarker);
                }

                // Create a custom icon for the location marker
                const customIcon = L.divIcon({
                    html: '<i class="fas fa-map-marker-alt" style="color: #dc3545; font-size: 24px;"></i>',
                    className: 'custom-div-icon',
                    iconSize: [24, 24],
                    iconAnchor: [12, 24],
                    popupAnchor: [0, -24]
                });

                // Add new marker
                searchMarker = L.marker(
                    [data.coordinates.lat, data.coordinates.lon],
                    { icon: customIcon }
                ).addTo(map);

                // Create popup content
                const popupContent = `
                    <div style="min-width: 200px;">
                        <h6 style="margin-bottom: 8px;">${data.name || 'Location'}</h6>
                        <p style="margin-bottom: 5px; font-size: 0.9em;">${data.address || searchInput}</p>
                    </div>
                `;

                // Add popup to marker
                searchMarker.bindPopup(popupContent).openPopup();

                // Fly to location with smooth animation
                map.flyTo(
                    [data.coordinates.lat, data.coordinates.lon],
                    16,
                    {
                        duration: 1.5,
                        easeLinearity: 0.25
                    }
                );

                // Clear any existing drawn items
                drawnItems.clearLayers();
                markers.clearLayers();
            } else {
                alert('Location not found. Please try a different search term.');
            }
        })
        .catch(error => {
            // Reset button state
            searchButton.innerHTML = originalButtonText;
            searchButton.disabled = false;
            
            console.error('Error:', error);
            alert('Error searching for location. Please try again.');
        });
    }

    // Add search box enter key handler
    document.getElementById('location-search').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchLocation();
        }
    });

    // Make searchLocation function globally available
    window.searchLocation = searchLocation;

    // Handle drawn shapes
    map.on('draw:created', function(e) {
        drawnItems.clearLayers();
        const layer = e.layer;
        drawnItems.addLayer(layer);
        
        // Get bounds of the drawn shape
        const bounds = layer.getBounds();
        const center = bounds.getCenter();
        
        // Calculate area corners
        const northEast = bounds.getNorthEast();
        const southWest = bounds.getSouthWest();
        
        // Detect entities within the drawn area
        detectEntitiesInArea({
            center: center,
            bounds: {
                north: northEast.lat,
                south: southWest.lat,
                east: northEast.lng,
                west: southWest.lng
            },
            type: e.layerType
        });
    });

    // Function to detect entities in drawn area
    function detectEntitiesInArea(area) {
        markers.clearLayers();
        
        // Show loading state
        updateLoadingState(true);
        
        fetch('/detect_entities', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                lat: area.center.lat,
                lon: area.center.lng,
                bounds: area.bounds,
                type: area.type,
                radius: calculateRadius(area.bounds)
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayEntities(data.entities);
                displayAnalysis(data.analysis);
                
                // Generate and display entity-based suggestions
                const entityBasedSuggestions = generateEntityBasedSuggestions(data.entities);
                displayEntityBasedSuggestions(entityBasedSuggestions);
                
                // Generate and display AI development plan
                const metrics = calculateAreaMetrics(data.entities);
                const developmentPlan = generateAIDevelopmentPlan(data.entities, metrics);
                displayAIDevelopmentPlan(developmentPlan);
            } else {
                alert('Failed to detect entities: ' + data.error);
            }
            updateLoadingState(false);
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Failed to detect entities');
            updateLoadingState(false);
        });
    }

    // Calculate radius based on bounds
    function calculateRadius(bounds) {
        const latDiff = bounds.north - bounds.south;
        const lonDiff = bounds.east - bounds.west;
        // Convert to meters (approximate)
        const radius = Math.max(
            haversineDistance(bounds.north, bounds.west, bounds.south, bounds.east) / 2,
            1000 // Minimum radius of 1km
        );
        return radius;
    }

    // Haversine distance calculation
    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    // Function to display detected entities
    function displayEntities(entities) {
        // Update counters
        document.getElementById('naturalCount').textContent = entities.natural_features.length;
        document.getElementById('waterCount').textContent = entities.water_bodies.length;
        document.getElementById('greenCount').textContent = entities.green_spaces.length;
        document.getElementById('roadCount').textContent = entities.roads.length;
        document.getElementById('buildingCount').textContent = entities.buildings.length;
        document.getElementById('landmarkCount').textContent = entities.landmarks.length;
        
        // Update lists with AI detection information
        updateEntityList('naturalFeaturesList', entities.natural_features);
        updateEntityList('waterBodiesList', entities.water_bodies);
        updateEntityList('greenSpacesList', entities.green_spaces);
        updateEntityList('roadsList', entities.roads);
        updateEntityList('buildingsList', entities.buildings);
        updateEntityList('landmarksList', entities.landmarks);
        
        // Add markers to map
        addEntityMarkers(entities);
    }

    // Function to update entity lists with AI detection information
    function updateEntityList(elementId, entities) {
        const element = document.getElementById(elementId);
        if (entities.length === 0) {
            element.innerHTML = `<p class="text-muted mb-0">No entities detected</p>`;
            return;
        }
        
        const list = entities.map(entity => `
            <div class="entity-item mb-2">
                <strong>${entity.name}</strong>
                <br>
                <small class="text-muted">Type: ${entity.type}</small>
                ${entity.detected_types && entity.detected_types.length > 0 ? `
                    <br>
                    <small class="text-info">
                        AI Detected: ${entity.detected_types.join(', ')}
                    </small>
                ` : ''}
            </div>
        `).join('');
        
        element.innerHTML = list;
    }

    // Function to add markers to map
    function addEntityMarkers(entities) {
        markers.clearLayers();
        
        const entityTypes = [
            'natural_features',
            'water_bodies',
            'green_spaces',
            'roads',
            'buildings',
            'landmarks',
            'amenities'
        ];
        
        entityTypes.forEach(type => {
            entities[type].forEach(entity => {
                if (entity.coordinates) {
                    const marker = L.marker([entity.coordinates.lat, entity.coordinates.lon], {
                        icon: getEntityIcon(type)
                    });
                    
                    marker.bindPopup(`
                        <strong>${entity.name}</strong><br>
                        Type: ${entity.type}
                        ${entity.detected_types ? `
                            <br>
                            <small class="text-info">
                                AI Detected: ${entity.detected_types.join(', ')}
                            </small>
                        ` : ''}
                    `);
                    
                    markers.addLayer(marker);
                }
            });
        });
    }

    // Function to get appropriate icon for entity type
    function getEntityIcon(type) {
        const iconMapping = {
            'natural_features': 'mountain',
            'water_bodies': 'water',
            'green_spaces': 'tree',
            'roads': 'road',
            'buildings': 'building',
            'landmarks': 'monument',
            'amenities': 'store'
        };
        
        return L.divIcon({
            html: `<i class="fas fa-${iconMapping[type]}"></i>`,
            className: 'entity-marker-icon',
            iconSize: [20, 20]
        });
    }

    // Function to display analysis results with AI detection information
    function displayAnalysis(analysis) {
        const analysisDiv = document.getElementById('analysisResults');
        
        const content = `
            <div class="analysis-summary">
                <p><strong>Entity Distribution:</strong></p>
                <ul class="mb-3">
                    ${Object.entries(analysis.entity_counts).map(([category, count]) => 
                        `<li>${category.replace('_', ' ')}: ${count}</li>`
                    ).join('')}
                </ul>
                <p><strong>Key Findings:</strong></p>
                <ul class="mb-3">
                    ${analysis.key_findings.map(finding => 
                        `<li>${finding}</li>`
                    ).join('')}
                </ul>
                ${analysis.ai_detected_types && analysis.ai_detected_types.length > 0 ? `
                    <p><strong>AI-Detected Categories:</strong></p>
                    <ul class="mb-0">
                        ${analysis.ai_detected_types.map(type => 
                            `<li>${type}</li>`
                        ).join('')}
                    </ul>
                ` : ''}
            </div>
        `;
        
        analysisDiv.innerHTML = content;
    }

    // Function to update loading state
    function updateLoadingState(isLoading) {
        const elements = [
            'naturalFeaturesList',
            'waterBodiesList',
            'greenSpacesList',
            'roadsList',
            'buildingsList',
            'landmarksList',
            'analysisResults'
        ];
        
        elements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (isLoading) {
                element.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>';
            }
        });
    }

    // Remove the simple click handler since we're now using drawn areas
    map.off('click');

    // Add scale control
    L.control.scale().addTo(map);

    // Initialize OSM Buildings for 3D view
    let osmb = null;
    let is3DMode = false;

    function toggle3DView() {
        const map3DDiv = document.getElementById('map3D');
        const developmentControls = document.getElementById('developmentControls');
        
        if (!is3DMode) {
            // Initialize 3D view
            map3DDiv.style.display = 'block';
            developmentControls.style.display = 'block';
            
            if (!osmb) {
                osmb = new OSMBuildings({
                    container: 'map3D',
                    position: map.getCenter(),
                    zoom: map.getZoom(),
                    tilt: 40,
                    rotation: 0,
                    effects: ['shadows'],
                    minZoom: 15,
                    maxZoom: 20
                });
                
                // Add base map
                osmb.addMapTiles(
                    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    {
                        attribution: '© OpenStreetMap contributors'
                    }
                );
                
                // Add building layer
                osmb.addGeoJSONTiles(
                    'https://{s}.data.osmbuildings.org/0.2/anonymous/tile/{z}/{x}/{y}.json'
                );
            }
            
            // Sync position with 2D map
            const center = map.getCenter();
            osmb.setPosition({ latitude: center.lat, longitude: center.lng });
            
        } else {
            // Hide 3D view
            map3DDiv.style.display = 'none';
            developmentControls.style.display = 'none';
        }
        
        is3DMode = !is3DMode;
    }

    // Function to generate development suggestions based on entity analysis
    function generateDevelopmentSuggestions(entities, analysis) {
        const suggestions = {
            infrastructure: [],
            environmental: [],
            community: [],
            smartCity: [], // New category for smart city initiatives
            sustainability: [] // New category for sustainability suggestions
        };
        
        // Calculate area metrics
        const metrics = calculateAreaMetrics(entities);
        
        // Infrastructure suggestions based on detailed analysis
        analyzeInfrastructureNeeds(entities, metrics, suggestions);
        
        // Environmental suggestions based on area characteristics
        analyzeEnvironmentalNeeds(entities, metrics, suggestions);
        
        // Community development suggestions
        analyzeCommunityNeeds(entities, metrics, suggestions);
        
        // Smart city initiatives
        analyzeSmartCityOpportunities(entities, metrics, suggestions);
        
        // Sustainability suggestions
        analyzeSustainabilityNeeds(entities, metrics, suggestions);
        
        return suggestions;
    }

    function calculateAreaMetrics(entities) {
        return {
            buildingDensity: entities.buildings.length / Math.max(1, entities.roads.length),
            greenSpaceRatio: entities.green_spaces.length / Math.max(1, entities.buildings.length),
            amenityRatio: entities.amenities.length / Math.max(1, entities.buildings.length),
            waterAccessibility: entities.water_bodies.length > 0,
            hasPublicTransport: entities.amenities.some(a => a.type === 'public_transport'),
            landmarkDensity: entities.landmarks.length / Math.max(1, entities.buildings.length),
            totalBuildings: entities.buildings.length,
            totalRoads: entities.roads.length,
            totalGreenSpaces: entities.green_spaces.length
        };
    }

    function analyzeInfrastructureNeeds(entities, metrics, suggestions) {
        // Road connectivity
        if (metrics.totalRoads < metrics.totalBuildings * 0.2) {
            suggestions.infrastructure.push({
                priority: 'high',
                suggestion: 'Critical need for improved road connectivity',
                details: 'Area has insufficient road coverage for building density',
                implementation: [
                    'Develop new connecting roads',
                    'Widen existing roads where possible',
                    'Add pedestrian pathways'
                ]
            });
        }

        // Public transport
        if (!metrics.hasPublicTransport && metrics.totalBuildings > 5) {
            suggestions.infrastructure.push({
                priority: 'high',
                suggestion: 'Implement public transportation access',
                details: 'Area lacks public transport despite significant development',
                implementation: [
                    'Add bus stops',
                    'Consider light rail connections',
                    'Develop transport hubs'
                ]
            });
        }

        // Building density management
        if (metrics.buildingDensity > 3) {
            suggestions.infrastructure.push({
                priority: 'medium',
                suggestion: 'Optimize building density',
                details: 'Area shows high building concentration relative to infrastructure',
                implementation: [
                    'Expand utility infrastructure',
                    'Add parking facilities',
                    'Improve emergency access routes'
                ]
            });
        }
    }

    function analyzeEnvironmentalNeeds(entities, metrics, suggestions) {
        // Green space requirements
        if (metrics.greenSpaceRatio < 0.15) {
            suggestions.environmental.push({
                priority: 'high',
                suggestion: 'Critical need for green spaces',
                details: 'Area has insufficient green coverage for urban wellness',
                implementation: [
                    'Create pocket parks',
                    'Develop rooftop gardens',
                    'Plant street trees',
                    'Create green corridors'
                ]
            });
        }

        // Water management
        if (!metrics.waterAccessibility) {
            suggestions.environmental.push({
                priority: 'medium',
                suggestion: 'Improve water feature integration',
                details: 'Area lacks water elements for environmental balance',
                implementation: [
                    'Create rainwater gardens',
                    'Develop water retention features',
                    'Install decorative fountains',
                    'Create bioswales'
                ]
            });
        }

        // Air quality considerations
        if (metrics.buildingDensity > 2 && metrics.greenSpaceRatio < 0.2) {
            suggestions.environmental.push({
                priority: 'high',
                suggestion: 'Address air quality concerns',
                details: 'High building density with insufficient green space may impact air quality',
                implementation: [
                    'Create vertical gardens',
                    'Establish car-free zones',
                    'Install air quality monitors'
                ]
            });
        }
    }

    function analyzeCommunityNeeds(entities, metrics, suggestions) {
        // Public spaces
        if (metrics.amenityRatio < 0.1) {
            suggestions.community.push({
                priority: 'high',
                suggestion: 'Develop community gathering spaces',
                details: 'Area lacks sufficient public amenities for community interaction',
                implementation: [
                    'Create community centers',
                    'Develop public squares',
                    'Add recreational facilities',
                    'Install public art spaces'
                ]
            });
        }

        // Cultural preservation
        if (metrics.landmarkDensity < 0.05) {
            suggestions.community.push({
                priority: 'medium',
                suggestion: 'Enhance cultural identity',
                details: 'Area could benefit from more cultural and historical elements',
                implementation: [
                    'Preserve historical buildings',
                    'Create heritage trails',
                    'Install cultural information points',
                    'Develop local museums'
                ]
            });
        }
    }

    function analyzeSmartCityOpportunities(entities, metrics, suggestions) {
        suggestions.smartCity.push({
            priority: 'medium',
            suggestion: 'Implement smart city features',
            details: 'Area can benefit from modern urban technology integration',
            implementation: [
                'Install smart street lighting',
                'Add public WiFi zones',
                'Implement smart parking systems',
                'Deploy environmental sensors'
            ]
        });
    }

    function analyzeSustainabilityNeeds(entities, metrics, suggestions) {
        if (metrics.buildingDensity > 1.5) {
            suggestions.sustainability.push({
                priority: 'high',
                suggestion: 'Enhance sustainability features',
                details: 'Area requires improved sustainability measures',
                implementation: [
                    'Install solar panels',
                    'Implement rainwater harvesting',
                    'Create composting stations',
                    'Develop bike-sharing systems'
                ]
            });
        }
    }

    // Enhanced suggestion display function
    function displayDevelopmentSuggestions(suggestions) {
        const sections = {
            infrastructure: document.getElementById('infrastructureSuggestions'),
            environmental: document.getElementById('environmentalSuggestions'),
            community: document.getElementById('communitySuggestions'),
            smartCity: document.getElementById('smartCitySuggestions'),
            sustainability: document.getElementById('sustainabilitySuggestions')
        };
        
        for (const [category, suggestionList] of Object.entries(suggestions)) {
            if (!sections[category]) continue;
            
            if (suggestionList.length === 0) {
                sections[category].innerHTML = '<p class="text-muted">No suggestions for this category</p>';
                continue;
            }
            
            const content = suggestionList.map(item => `
                <div class="suggestion-item priority-${item.priority}">
                    <span class="badge bg-${getPriorityColor(item.priority)} mb-1">
                        ${item.priority.toUpperCase()}
                    </span>
                    <h6 class="mb-1">${item.suggestion}</h6>
                    <p class="mb-2 text-muted small">${item.details}</p>
                    ${item.implementation ? `
                        <div class="implementation-steps">
                            <small class="text-primary">Recommended steps:</small>
                            <ul class="mb-0 small">
                                ${item.implementation.map(step => `<li>${step}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `).join('');
            
            sections[category].innerHTML = content;
        }
    }

    function getPriorityColor(priority) {
        const colors = {
            high: 'danger',
            medium: 'warning',
            low: 'success'
        };
        return colors[priority] || 'primary';
    }

    // Function to add new development to 3D view
    function addNewDevelopment() {
        if (!is3DMode) {
            alert('Please enable 3D view first');
            return;
        }
        
        const type = document.getElementById('developmentType').value;
        const name = document.getElementById('developmentName').value;
        const description = document.getElementById('developmentDescription').value;
        
        if (!type || !name) {
            alert('Please fill in all required fields');
            return;
        }
        
        // Get center of current view
        const position = osmb.getPosition();
        
        // Create GeoJSON feature for the new development
        const feature = {
            type: 'Feature',
            properties: {
                name: name,
                type: type,
                description: description,
                height: type === 'building' ? 40 : 5, // Default heights
                color: getDevelopmentColor(type)
            },
            geometry: {
                type: 'Polygon',
                coordinates: createDevelopmentShape(position, type)
            }
        };
        
        // Add to 3D view
        osmb.addFeature(feature);
    }

    function getDevelopmentColor(type) {
        const colors = {
            building: '#808080',
            park: '#228B22',
            road: '#A9A9A9',
            facility: '#4682B4'
        };
        return colors[type] || '#808080';
    }

    function createDevelopmentShape(position, type) {
        // Create a simple square shape - can be enhanced for different development types
        const size = type === 'road' ? 0.001 : 0.0005;
        const coordinates = [
            [position.longitude - size, position.latitude - size],
            [position.longitude + size, position.latitude - size],
            [position.longitude + size, position.latitude + size],
            [position.longitude - size, position.latitude + size],
            [position.longitude - size, position.latitude - size]
        ];
        return [coordinates];
    }

    // Add this new function for entity-based development suggestions
    function generateEntityBasedSuggestions(entities) {
        const suggestions = {
            buildingDevelopment: [],
            infrastructureImprovement: [],
            greenSpaceDevelopment: [],
            amenityAdditions: [],
            waterManagement: []
        };

        // Analyze buildings and suggest improvements
        analyzeBuildingEntities(entities.buildings, suggestions);
        
        // Analyze roads and transportation
        analyzeTransportationEntities(entities.roads, entities.buildings, suggestions);
        
        // Analyze green spaces and natural features
        analyzeGreenSpaceEntities(entities.green_spaces, entities.natural_features, entities.buildings, suggestions);
        
        // Analyze water bodies and water management
        analyzeWaterEntities(entities.water_bodies, suggestions);
        
        // Analyze amenities and community facilities
        analyzeAmenityEntities(entities.amenities, entities.buildings, suggestions);

        return suggestions;
    }

    function analyzeBuildingEntities(buildings, suggestions) {
        const buildingTypes = buildings.map(b => b.type);
        const buildingCount = buildings.length;

        // Check building diversity
        const residentialCount = buildingTypes.filter(t => t.includes('residential')).length;
        const commercialCount = buildingTypes.filter(t => t.includes('commercial')).length;

        if (residentialCount / buildingCount < 0.3) {
            suggestions.buildingDevelopment.push({
                type: 'residential',
                priority: 'high',
                suggestion: 'Add residential buildings',
                details: 'Area lacks sufficient residential development',
                specific_recommendations: [
                    {
                        type: 'Apartment Complex',
                        description: 'Modern apartment buildings with mixed unit sizes',
                        benefits: ['Increased housing density', 'Efficient land use'],
                        estimated_impact: 'High'
                    },
                    {
                        type: 'Townhouses',
                        description: 'Row of connected residential units',
                        benefits: ['Community feel', 'Space efficiency'],
                        estimated_impact: 'Medium'
                    }
                ]
            });
        }

        if (commercialCount / buildingCount < 0.2) {
            suggestions.buildingDevelopment.push({
                type: 'commercial',
                priority: 'medium',
                suggestion: 'Develop commercial spaces',
                details: 'Area needs more commercial development',
                specific_recommendations: [
                    {
                        type: 'Retail Complex',
                        description: 'Mixed retail space with various shop sizes',
                        benefits: ['Economic growth', 'Job creation'],
                        estimated_impact: 'High'
                    },
                    {
                        type: 'Office Space',
                        description: 'Modern office buildings with flexible layouts',
                        benefits: ['Business growth', 'Employment opportunities'],
                        estimated_impact: 'High'
                    }
                ]
            });
        }
    }

    function analyzeTransportationEntities(roads, buildings, suggestions) {
        const roadDensity = roads.length / Math.max(buildings.length, 1);
        
        if (roadDensity < 0.5) {
            suggestions.infrastructureImprovement.push({
                type: 'transportation',
                priority: 'high',
                suggestion: 'Improve road network',
                details: 'Area requires better road connectivity',
                specific_recommendations: [
                    {
                        type: 'Main Road',
                        description: 'New arterial road connecting major areas',
                        specifications: {
                            width: '30m',
                            lanes: 4,
                            features: ['Bike lanes', 'Pedestrian walkways']
                        },
                        estimated_impact: 'High'
                    },
                    {
                        type: 'Internal Roads',
                        description: 'Network of internal roads for local access',
                        specifications: {
                            width: '15m',
                            lanes: 2,
                            features: ['Sidewalks', 'Street parking']
                        },
                        estimated_impact: 'Medium'
                    }
                ]
            });
        }
    }

    function analyzeGreenSpaceEntities(greenSpaces, naturalFeatures, buildings, suggestions) {
        const greenSpaceRatio = (greenSpaces.length + naturalFeatures.length) / Math.max(buildings.length, 1);
        
        if (greenSpaceRatio < 0.2) {
            suggestions.greenSpaceDevelopment.push({
                type: 'parks',
                priority: 'high',
                suggestion: 'Develop green spaces',
                details: 'Area needs more green spaces for environmental balance',
                specific_recommendations: [
                    {
                        type: 'Community Park',
                        description: 'Large multi-purpose park with various facilities',
                        features: [
                            'Playground equipment',
                            'Walking trails',
                            'Sports facilities',
                            'Native plant gardens'
                        ],
                        size_recommendation: '5-10 hectares',
                        estimated_impact: 'High'
                    },
                    {
                        type: 'Pocket Parks',
                        description: 'Small urban green spaces',
                        features: [
                            'Seating areas',
                            'Small play areas',
                            'Urban gardens'
                        ],
                        size_recommendation: '0.1-0.5 hectares',
                        estimated_impact: 'Medium'
                    }
                ]
            });
        }
    }

    function analyzeWaterEntities(waterBodies, suggestions) {
        if (waterBodies.length === 0) {
            suggestions.waterManagement.push({
                type: 'water_features',
                priority: 'medium',
                suggestion: 'Add water features',
                details: 'Area would benefit from water features',
                specific_recommendations: [
                    {
                        type: 'Artificial Lake',
                        description: 'Created water body for recreation and ecology',
                        features: [
                            'Walking paths',
                            'Seating areas',
                            'Aquatic plants',
                            'Water quality management'
                        ],
                        size_recommendation: '1-2 hectares',
                        estimated_impact: 'High'
                    },
                    {
                        type: 'Rain Gardens',
                        description: 'Natural water management features',
                        features: [
                            'Native plants',
                            'Natural filtration',
                            'Flood control'
                        ],
                        size_recommendation: '100-500 sq meters',
                        estimated_impact: 'Medium'
                    }
                ]
            });
        }
    }

    function analyzeAmenityEntities(amenities, buildings, suggestions) {
        const amenityRatio = amenities.length / Math.max(buildings.length, 1);
        
        if (amenityRatio < 0.15) {
            suggestions.amenityAdditions.push({
                type: 'community_facilities',
                priority: 'high',
                suggestion: 'Add community amenities',
                details: 'Area lacks sufficient community facilities',
                specific_recommendations: [
                    {
                        type: 'Community Center',
                        description: 'Multi-purpose community facility',
                        features: [
                            'Meeting rooms',
                            'Sports facilities',
                            'Educational spaces',
                            'Event halls'
                        ],
                        size_recommendation: '2000-3000 sq meters',
                        estimated_impact: 'High'
                    },
                    {
                        type: 'Healthcare Facility',
                        description: 'Local medical center',
                        features: [
                            'Primary care services',
                            'Emergency care',
                            'Pharmacy',
                            'Specialist clinics'
                        ],
                        size_recommendation: '1500-2000 sq meters',
                        estimated_impact: 'High'
                    }
                ]
            });
        }
    }

    // Update the display function to show entity-based suggestions
    function displayEntityBasedSuggestions(suggestions) {
        const suggestionsDiv = document.getElementById('developmentSuggestions');
        
        const content = `
            <div class="entity-based-suggestions">
                ${Object.entries(suggestions).map(([category, categorySuggestions]) => `
                    <div class="suggestion-category mb-4">
                        <h6 class="category-title">${formatCategoryTitle(category)}</h6>
                        ${categorySuggestions.map(suggestion => `
                            <div class="suggestion-item priority-${suggestion.priority}">
                                <div class="suggestion-header">
                                    <span class="badge bg-${getPriorityColor(suggestion.priority)} mb-2">
                                        ${suggestion.priority.toUpperCase()}
                                    </span>
                                    <h6 class="mb-1">${suggestion.suggestion}</h6>
                                    <p class="text-muted small mb-2">${suggestion.details}</p>
                                </div>
                                
                                <div class="specific-recommendations">
                                    ${suggestion.specific_recommendations.map(rec => `
                                        <div class="recommendation-detail mt-2">
                                            <strong class="text-primary">${rec.type}</strong>
                                            <p class="mb-1 small">${rec.description}</p>
                                            ${rec.features ? `
                                                <div class="features small">
                                                    <strong>Features:</strong>
                                                    <ul class="mb-1">
                                                        ${rec.features.map(f => `<li>${f}</li>`).join('')}
                                                    </ul>
                                                </div>
                                            ` : ''}
                                            ${rec.specifications ? `
                                                <div class="specifications small">
                                                    <strong>Specifications:</strong>
                                                    <ul class="mb-1">
                                                        ${Object.entries(rec.specifications).map(([key, value]) => 
                                                            `<li>${key}: ${Array.isArray(value) ? value.join(', ') : value}</li>`
                                                        ).join('')}
                                                    </ul>
                                                </div>
                                            ` : ''}
                                            ${rec.size_recommendation ? `
                                                <div class="size-recommendation small">
                                                    <strong>Recommended Size:</strong> ${rec.size_recommendation}
                                                </div>
                                            ` : ''}
                                            <div class="impact small">
                                                <strong>Estimated Impact:</strong> ${rec.estimated_impact}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `;
        
        suggestionsDiv.innerHTML = content;
    }

    function formatCategoryTitle(category) {
        return category
            .split(/(?=[A-Z])/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    // Update the display function to show the AI development plan
    function displayAIDevelopmentPlan(plan) {
        const planDiv = document.getElementById('developmentSuggestions');
        
        const content = `
            <div class="development-plan">
                <div class="development-score mb-4">
                    <h6>Development Potential Score: ${plan.developmentScore}/100</h6>
                    <div class="progress">
                        <div class="progress-bar" role="progressbar" 
                             style="width: ${plan.developmentScore}%" 
                             aria-valuenow="${plan.developmentScore}" 
                             aria-valuemin="0" 
                             aria-valuemax="100">
                        </div>
                    </div>
                </div>

                <div class="phased-recommendations">
                    <h6>Short-term Actions (0-2 years)</h6>
                    <div class="recommendation-list mb-3">
                        ${generateRecommendationList(plan.shortTerm)}
                    </div>

                    <h6>Medium-term Development (2-5 years)</h6>
                    <div class="recommendation-list mb-3">
                        ${generateRecommendationList(plan.mediumTerm)}
                    </div>

                    <h6>Long-term Vision (5+ years)</h6>
                    <div class="recommendation-list mb-3">
                        ${generateRecommendationList(plan.longTerm)}
                    </div>
                </div>

                <div class="potential-impact mt-4">
                    <h6>Projected Impact Analysis</h6>
                    <div class="impact-metrics">
                        ${generateImpactMetrics(plan.potentialImpact)}
                    </div>
                </div>
            </div>
        `;

        planDiv.innerHTML = content;
    }

    function generateRecommendationList(recommendations) {
        return recommendations.map(rec => `
            <div class="recommendation-item priority-${rec.priority.toLowerCase()}">
                <span class="badge bg-${getPriorityColor(rec.priority.toLowerCase())}">
                    ${rec.priority}
                </span>
                <h6 class="mb-1">${rec.action}</h6>
                <p class="mb-2 text-muted small">${rec.details}</p>
                <div class="recommendation-details">
                    <small class="text-primary">Expected Impact:</small>
                    <p class="mb-0 small">${rec.estimatedImpact}</p>
                </div>
            </div>
        `).join('');
    }

    function generateImpactMetrics(impact) {
        return `
            <div class="row">
                <div class="col-md-6 mb-2">
                    <div class="impact-metric">
                        <small>Livability Improvement</small>
                        <div class="progress">
                            <div class="progress-bar bg-success" style="width: ${impact.livabilityImprovement}%"></div>
                        </div>
                    </div>
                </div>
                <div class="col-md-6 mb-2">
                    <div class="impact-metric">
                        <small>Sustainability Gain</small>
                        <div class="progress">
                            <div class="progress-bar bg-info" style="width: ${impact.sustainabilityGain}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}); 