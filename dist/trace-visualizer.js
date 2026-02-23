/**
 * Trace Visualizer - Main JavaScript
 * A browser-based tool for visualizing OpenTelemetry traces in a waterfall view
 */

class TraceVisualizer {
    constructor() {
        this.spans = [];
        this.spanTree = [];
        this.spanMap = new Map();
        this.serviceColors = new Map();
        this.selectedSpan = null;
        this.collapsedSpans = new Set();
        this.traceStartTime = 0;
        this.traceEndTime = 0;
        this.traceDuration = 0;
        
        // Search state
        this.searchQuery = '';
        this.searchResults = [];
        this.currentSearchIndex = -1;
        
        this.colorPalette = [
            '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e',
            '#60a5fa', '#38bdf8', '#22d3ee', '#2dd4bf', '#4ade80',
            '#1d4ed8', '#0284c7', '#0891b2', '#0d9488', '#16a34a',
            '#2563eb', '#0369a1', '#0e7490', '#0f766e', '#15803d'
        ];
        
        this.init();
    }
    
    init() {
        // DOM elements
        this.fileInput = document.getElementById('file-input');
        this.loadSampleBtn = document.getElementById('load-sample');
        this.collapseAllBtn = document.getElementById('collapse-all');
        this.expandAllBtn = document.getElementById('expand-all');
        this.waterfallBody = document.getElementById('waterfall-body');
        this.timeMarkers = document.getElementById('time-markers');
        this.traceInfo = document.getElementById('trace-info');
        this.legendItems = document.getElementById('legend-items');
        this.spanDetails = document.getElementById('span-details');
        this.spanCountEl = document.getElementById('span-count');
        this.traceDurationEl = document.getElementById('trace-duration');
        this.emptyState = document.getElementById('empty-state');
        
        // Search elements
        this.searchInput = document.getElementById('search-input');
        this.searchNav = document.getElementById('search-nav');
        this.searchCount = document.getElementById('search-count');
        this.searchPrevBtn = document.getElementById('search-prev');
        this.searchNextBtn = document.getElementById('search-next');
        this.searchClearBtn = document.getElementById('search-clear');
        
        // Event listeners
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.loadSampleBtn.addEventListener('click', () => this.loadSampleTrace());
        this.collapseAllBtn.addEventListener('click', () => this.collapseAll());
        this.expandAllBtn.addEventListener('click', () => this.expandAll());
        
        // Search event listeners
        this.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
        this.searchPrevBtn.addEventListener('click', () => this.navigateSearch(-1));
        this.searchNextBtn.addEventListener('click', () => this.navigateSearch(1));
        this.searchClearBtn.addEventListener('click', () => this.clearSearch());
        
        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.spans.length > 0) {
                this.render();
            }
        });
    }
    
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.loadTrace(data);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                alert('Error parsing JSON file. Please ensure it is a valid trace file.');
            }
        };
        reader.readAsText(file);
    }
    
    async loadSampleTrace() {
        try {
            const response = await fetch('sample-trace.json');
            if (!response.ok) {
                throw new Error('Failed to load sample trace');
            }
            const data = await response.json();
            this.loadTrace(data);
        } catch (error) {
            console.error('Error loading sample trace:', error);
            alert('Error loading sample trace file.');
        }
    }
    
    loadTrace(data) {
        // Reset state
        this.spans = [];
        this.spanTree = [];
        this.spanMap = new Map();
        this.serviceColors = new Map();
        this.selectedSpan = null;
        this.collapsedSpans = new Set();
        
        // Parse spans from various trace formats
        this.spans = this.parseSpans(data);
        
        if (this.spans.length === 0) {
            alert('No spans found in the trace file.');
            return;
        }
        
        // Calculate trace time bounds
        this.calculateTimeBounds();
        
        // Build span tree
        this.buildSpanTree();
        
        // Assign colors to services
        this.assignServiceColors();
        
        // Enable controls
        this.collapseAllBtn.disabled = false;
        this.expandAllBtn.disabled = false;
        this.searchInput.disabled = false;
        
        // Clear search
        this.clearSearch();
        
        // Render
        this.render();
        this.updateTraceInfo();
        this.updateLegend();
        this.updateFooter();
    }
    
    parseSpans(data) {
        let spans = [];
        
        // Handle array of spans (OpenSearch/Elasticsearch format)
        if (Array.isArray(data)) {
            spans = data.map(item => this.normalizeSpan(item));
        }
        // Handle object with spans property
        else if (data.spans && Array.isArray(data.spans)) {
            spans = data.spans.map(item => this.normalizeSpan(item));
        }
        // Handle object with data property (some exports)
        else if (data.data && Array.isArray(data.data)) {
            spans = data.data.map(item => this.normalizeSpan(item));
        }
        // Handle resourceSpans format (OTLP)
        else if (data.resourceSpans && Array.isArray(data.resourceSpans)) {
            spans = this.parseOTLPFormat(data);
        }
        
        return spans.filter(s => s !== null);
    }
    
    normalizeSpan(item) {
        // Handle OpenSearch/Elasticsearch format with _source
        const source = item._source || item;
        
        if (!source.spanId && !source.span_id) {
            return null;
        }
        
        const startTime = this.parseTime(source.startTime || source.start_time);
        const endTime = this.parseTime(source.endTime || source.end_time);
        
        // Extract attributes
        const attributes = {};
        for (const key of Object.keys(source)) {
            if (key.startsWith('span.attributes.') || key.startsWith('resource.attributes.')) {
                attributes[key] = source[key];
            }
        }
        
        return {
            spanId: source.spanId || source.span_id,
            parentSpanId: source.parentSpanId || source.parent_span_id || null,
            traceId: source.traceId || source.trace_id,
            name: source.name || 'Unknown',
            serviceName: source.serviceName || source.service_name || 
                        source['resource.attributes.service@name'] || 'Unknown Service',
            kind: this.parseSpanKind(source.kind),
            startTime: startTime,
            endTime: endTime,
            duration: source.durationInNanos || source.duration || (endTime - startTime) * 1000000,
            statusCode: source.status?.code || source['status.code'] || 0,
            attributes: attributes,
            events: source.events || [],
            children: []
        };
    }
    
    parseOTLPFormat(data) {
        const spans = [];
        
        for (const resourceSpan of data.resourceSpans) {
            const serviceName = this.extractServiceName(resourceSpan.resource);
            
            for (const scopeSpan of (resourceSpan.scopeSpans || resourceSpan.instrumentationLibrarySpans || [])) {
                for (const span of scopeSpan.spans) {
                    spans.push({
                        spanId: span.spanId,
                        parentSpanId: span.parentSpanId || null,
                        traceId: span.traceId,
                        name: span.name || 'Unknown',
                        serviceName: serviceName,
                        kind: this.parseSpanKind(span.kind),
                        startTime: this.parseOTLPTime(span.startTimeUnixNano),
                        endTime: this.parseOTLPTime(span.endTimeUnixNano),
                        duration: (span.endTimeUnixNano - span.startTimeUnixNano),
                        statusCode: span.status?.code || 0,
                        attributes: this.parseOTLPAttributes(span.attributes),
                        events: span.events || [],
                        children: []
                    });
                }
            }
        }
        
        return spans;
    }
    
    extractServiceName(resource) {
        if (!resource || !resource.attributes) return 'Unknown Service';
        
        const serviceAttr = resource.attributes.find(a => a.key === 'service.name');
        return serviceAttr?.value?.stringValue || 'Unknown Service';
    }
    
    parseOTLPAttributes(attributes) {
        if (!attributes) return {};
        
        const result = {};
        for (const attr of attributes) {
            const value = attr.value?.stringValue || attr.value?.intValue || 
                         attr.value?.boolValue || attr.value?.doubleValue || '';
            result[attr.key] = value;
        }
        return result;
    }
    
    parseTime(timeStr) {
        if (!timeStr) return 0;
        if (typeof timeStr === 'number') return timeStr;
        
        // ISO 8601 format
        const date = new Date(timeStr);
        return date.getTime();
    }
    
    parseOTLPTime(nanos) {
        if (!nanos) return 0;
        return Number(nanos) / 1000000; // Convert nanoseconds to milliseconds
    }
    
    parseSpanKind(kind) {
        if (typeof kind === 'string') {
            if (kind.includes('SERVER')) return 'server';
            if (kind.includes('CLIENT')) return 'client';
            if (kind.includes('PRODUCER')) return 'producer';
            if (kind.includes('CONSUMER')) return 'consumer';
            if (kind.includes('INTERNAL')) return 'internal';
        }
        if (typeof kind === 'number') {
            const kinds = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'];
            return kinds[kind] || 'internal';
        }
        return 'internal';
    }
    
    calculateTimeBounds() {
        this.traceStartTime = Math.min(...this.spans.map(s => s.startTime));
        this.traceEndTime = Math.max(...this.spans.map(s => s.endTime));
        this.traceDuration = this.traceEndTime - this.traceStartTime;
    }
    
    buildSpanTree() {
        // Create a map of spanId -> span
        this.spanMap = new Map();
        for (const span of this.spans) {
            this.spanMap.set(span.spanId, span);
        }
        
        // Build tree structure
        const roots = [];
        for (const span of this.spans) {
            if (!span.parentSpanId || !this.spanMap.has(span.parentSpanId)) {
                roots.push(span);
            } else {
                const parent = this.spanMap.get(span.parentSpanId);
                if (parent) {
                    parent.children.push(span);
                }
            }
        }
        
        // Sort children by start time
        const sortChildren = (span) => {
            span.children.sort((a, b) => a.startTime - b.startTime);
            span.children.forEach(sortChildren);
        };
        
        roots.forEach(sortChildren);
        roots.sort((a, b) => a.startTime - b.startTime);
        
        this.spanTree = roots;
    }
    
    assignServiceColors() {
        const services = [...new Set(this.spans.map(s => s.serviceName))];
        services.sort();
        
        services.forEach((service, index) => {
            this.serviceColors.set(service, this.colorPalette[index % this.colorPalette.length]);
        });
    }
    
    render() {
        // Clear waterfall body
        this.waterfallBody.innerHTML = '';
        
        // Hide empty state
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }
        
        // Render time markers
        this.renderTimeMarkers();
        
        // Create container for spans
        const container = document.createElement('div');
        container.className = 'spans-container';
        
        // Render spans recursively
        this.spanTree.forEach(span => {
            this.renderSpan(span, container, 0);
        });
        
        this.waterfallBody.appendChild(container);
    }
    
    renderTimeMarkers() {
        this.timeMarkers.innerHTML = '';
        const markerCount = 6;
        
        for (let i = 0; i < markerCount; i++) {
            const marker = document.createElement('div');
            marker.className = 'time-marker';
            
            const time = (this.traceDuration / (markerCount - 1)) * i;
            marker.textContent = this.formatDuration(time);
            
            this.timeMarkers.appendChild(marker);
        }
    }
    
    renderSpan(span, container, depth, parentSpanId = null) {
        const row = document.createElement('div');
        row.className = 'span-row';
        row.dataset.spanId = span.spanId;
        if (parentSpanId) {
            row.dataset.parentSpanId = parentSpanId;
        }
        
        // Check if any ancestor is collapsed
        if (this.isAncestorCollapsed(span)) {
            row.classList.add('hidden');
        }
        
        if (span.statusCode !== 0 && span.statusCode !== 1) {
            row.classList.add('has-error');
        }
        
        if (this.selectedSpan === span.spanId) {
            row.classList.add('selected');
        }
        
        // Search highlighting
        if (this.searchResults.includes(span.spanId)) {
            row.classList.add('search-match');
            if (this.currentSearchIndex >= 0 && 
                this.searchResults[this.currentSearchIndex] === span.spanId) {
                row.classList.add('search-current');
            }
        }
        
        // Name cell
        const nameCell = document.createElement('div');
        nameCell.className = 'span-name-cell';
        
        // Indentation
        const indent = document.createElement('div');
        indent.className = 'span-indent';
        
        for (let i = 0; i < depth; i++) {
            const guide = document.createElement('div');
            guide.className = 'indent-guide';
            indent.appendChild(guide);
        }
        
        // Toggle button
        const toggle = document.createElement('div');
        toggle.className = 'span-toggle' + (span.children.length === 0 ? ' no-children' : '');
        if (this.collapsedSpans.has(span.spanId)) {
            toggle.classList.add('collapsed');
        }
        toggle.innerHTML = '▼';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSpan(span.spanId);
        });
        indent.appendChild(toggle);
        
        nameCell.appendChild(indent);
        
        // Service badge
        const serviceBadge = document.createElement('div');
        serviceBadge.className = 'span-service-badge';
        serviceBadge.style.backgroundColor = this.serviceColors.get(span.serviceName);
        nameCell.appendChild(serviceBadge);
        
        // Span name
        const nameText = document.createElement('div');
        nameText.className = 'span-name-text';
        nameText.textContent = span.name;
        nameText.title = span.name;
        nameCell.appendChild(nameText);
        
        // Kind badge
        if (span.kind && span.kind !== 'internal') {
            const kindBadge = document.createElement('span');
            kindBadge.className = 'span-kind-badge ' + span.kind;
            kindBadge.textContent = span.kind.charAt(0).toUpperCase();
            nameCell.appendChild(kindBadge);
        }
        
        row.appendChild(nameCell);
        
        // Timeline cell
        const timelineCell = document.createElement('div');
        timelineCell.className = 'span-timeline-cell';
        
        // Calculate bar position and width (account for padding: 16px left, 60px right for duration labels)
        const timelinePadding = 76;
        const timelineWidth = this.waterfallBody.clientWidth - 350 - timelinePadding; // Subtract name width and padding
        const startOffset = ((span.startTime - this.traceStartTime) / this.traceDuration) * timelineWidth;
        const barWidth = Math.max(3, ((span.endTime - span.startTime) / this.traceDuration) * timelineWidth);
        
        const barContainer = document.createElement('div');
        barContainer.className = 'span-bar-container';
        barContainer.style.left = startOffset + 'px';
        
        const bar = document.createElement('div');
        bar.className = 'span-bar';
        bar.style.width = barWidth + 'px';
        bar.style.backgroundColor = this.serviceColors.get(span.serviceName);
        
        // Duration label
        const durationLabel = document.createElement('span');
        durationLabel.className = 'span-bar-label';
        durationLabel.textContent = this.formatDuration(span.duration / 1000000); // Convert ns to ms
        
        if (barWidth > 80) {
            durationLabel.classList.add('inside');
        }
        
        bar.appendChild(durationLabel);
        barContainer.appendChild(bar);
        timelineCell.appendChild(barContainer);
        
        row.appendChild(timelineCell);
        
        // Add click handler
        row.addEventListener('click', () => this.selectSpan(span));
        
        container.appendChild(row);
        
        // Always render children, but hide them if collapsed
        span.children.forEach(child => {
            this.renderSpan(child, container, depth + 1, span.spanId);
        });
    }
    
    toggleSpan(spanId) {
        const isCollapsed = this.collapsedSpans.has(spanId);
        
        if (isCollapsed) {
            this.collapsedSpans.delete(spanId);
        } else {
            this.collapsedSpans.add(spanId);
        }
        
        // Update toggle button appearance
        const row = this.waterfallBody.querySelector(`[data-span-id="${spanId}"]`);
        if (row) {
            const toggle = row.querySelector('.span-toggle');
            if (toggle) {
                toggle.classList.toggle('collapsed', !isCollapsed);
            }
        }
        
        // Show/hide descendant spans
        this.updateDescendantsVisibility(spanId);
    }
    
    isAncestorCollapsed(span) {
        let current = span;
        while (current.parentSpanId) {
            if (this.collapsedSpans.has(current.parentSpanId)) {
                return true;
            }
            current = this.spanMap.get(current.parentSpanId);
            if (!current) break;
        }
        return false;
    }
    
    updateDescendantsVisibility(spanId) {
        const span = this.spanMap.get(spanId);
        if (!span) return;
        
        const updateChildren = (parentSpan) => {
            for (const child of parentSpan.children) {
                const childRow = this.waterfallBody.querySelector(`[data-span-id="${child.spanId}"]`);
                if (childRow) {
                    // Check if this child should be visible
                    const shouldBeHidden = this.isAncestorCollapsed(child);
                    childRow.classList.toggle('hidden', shouldBeHidden);
                }
                // Recursively update grandchildren
                updateChildren(child);
            }
        };
        
        updateChildren(span);
    }
    
    collapseAll() {
        this.spans.forEach(span => {
            if (span.children.length > 0) {
                this.collapsedSpans.add(span.spanId);
            }
        });
        this.render();
    }
    
    expandAll() {
        this.collapsedSpans.clear();
        this.render();
    }
    
    selectSpan(span) {
        // Remove previous selection
        const prevSelected = this.waterfallBody.querySelector('.span-row.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }
        
        // Add new selection
        this.selectedSpan = span.spanId;
        const newSelected = this.waterfallBody.querySelector(`[data-span-id="${span.spanId}"]`);
        if (newSelected) {
            newSelected.classList.add('selected');
        }
        
        this.updateSpanDetails(span);
    }
    
    updateTraceInfo() {
        const infoContent = document.createElement('div');
        infoContent.className = 'info-content';
        
        const rootSpan = this.spanTree[0];
        const traceId = rootSpan?.traceId || 'Unknown';
        
        infoContent.innerHTML = `
            <div class="info-row">
                <span class="info-label">Trace ID</span>
                <span class="info-value" title="${traceId}">${this.truncate(traceId, 16)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Duration</span>
                <span class="info-value">${this.formatDuration(this.traceDuration)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Spans</span>
                <span class="info-value">${this.spans.length}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Services</span>
                <span class="info-value">${this.serviceColors.size}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Start Time</span>
                <span class="info-value">${this.formatTimestamp(this.traceStartTime)}</span>
            </div>
        `;
        
        this.traceInfo.innerHTML = '<h3>Trace Information</h3>';
        this.traceInfo.appendChild(infoContent);
    }
    
    updateLegend() {
        this.legendItems.innerHTML = '';
        
        // Count spans per service
        const serviceCounts = new Map();
        this.spans.forEach(span => {
            const count = serviceCounts.get(span.serviceName) || 0;
            serviceCounts.set(span.serviceName, count + 1);
        });
        
        // Sort by count
        const sortedServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]);
        
        for (const [service, count] of sortedServices) {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <div class="legend-color" style="background-color: ${this.serviceColors.get(service)}"></div>
                <div class="legend-name" title="${service}">${service}</div>
                <div class="legend-count">${count}</div>
            `;
            this.legendItems.appendChild(item);
        }
    }
    
    updateSpanDetails(span) {
        const detailsContent = document.createElement('div');
        detailsContent.className = 'details-content';
        
        // Basic info section
        let html = `
            <div class="detail-section">
                <div class="detail-section-title">Basic Info</div>
                <div class="detail-row">
                    <span class="detail-label">Name</span>
                    <span class="detail-value">${span.name}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Service</span>
                    <span class="detail-value">${span.serviceName}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Span ID</span>
                    <span class="detail-value">${span.spanId}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Parent ID</span>
                    <span class="detail-value">${span.parentSpanId || 'None (root)'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Kind</span>
                    <span class="detail-value">${span.kind}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Status</span>
                    <span class="detail-value ${span.statusCode === 0 || span.statusCode === 1 ? 'status-ok' : 'status-error'}">
                        ${this.getStatusText(span.statusCode)}
                    </span>
                </div>
            </div>
            
            <div class="detail-section">
                <div class="detail-section-title">Timing</div>
                <div class="detail-row">
                    <span class="detail-label">Duration</span>
                    <span class="detail-value">${this.formatDuration(span.duration / 1000000)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Start Time</span>
                    <span class="detail-value">${this.formatTimestamp(span.startTime)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">End Time</span>
                    <span class="detail-value">${this.formatTimestamp(span.endTime)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Offset from Start</span>
                    <span class="detail-value">${this.formatDuration(span.startTime - this.traceStartTime)}</span>
                </div>
            </div>
        `;
        
        // Attributes section
        const attrKeys = Object.keys(span.attributes);
        if (attrKeys.length > 0) {
            html += `
                <div class="detail-section">
                    <div class="detail-section-title">Attributes (${attrKeys.length})</div>
                    <div class="attributes-list">
            `;
            
            attrKeys.sort().forEach(key => {
                const displayKey = key.replace('span.attributes.', '').replace('resource.attributes.', '');
                html += `
                    <div class="attribute-item">
                        <span class="attribute-key">${displayKey}:</span>
                        <span class="attribute-value">${span.attributes[key]}</span>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        detailsContent.innerHTML = html;
        
        this.spanDetails.innerHTML = '<h3>Span Details</h3>';
        this.spanDetails.appendChild(detailsContent);
    }
    
    updateFooter() {
        this.spanCountEl.textContent = `${this.spans.length} spans`;
        this.traceDurationEl.textContent = `Duration: ${this.formatDuration(this.traceDuration)}`;
    }
    
    getStatusText(code) {
        switch (code) {
            case 0: return 'Unset';
            case 1: return 'OK';
            case 2: return 'Error';
            default: return `Unknown (${code})`;
        }
    }
    
    formatDuration(ms) {
        if (ms < 0.001) {
            return '< 1μs';
        }
        if (ms < 1) {
            return (ms * 1000).toFixed(0) + 'μs';
        }
        if (ms < 1000) {
            return ms.toFixed(2) + 'ms';
        }
        if (ms < 60000) {
            return (ms / 1000).toFixed(2) + 's';
        }
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(1);
        return `${minutes}m ${seconds}s`;
    }
    
    formatTimestamp(ms) {
        const date = new Date(ms);
        return date.toISOString().replace('T', ' ').replace('Z', '');
    }
    
    truncate(str, len) {
        if (str.length <= len) return str;
        return str.slice(0, len) + '...';
    }
    
    // ==========================================================================
    // Search Functionality
    // ==========================================================================
    
    handleSearch(query) {
        this.searchQuery = query.toLowerCase().trim();
        this.searchResults = [];
        this.currentSearchIndex = -1;
        
        if (this.searchQuery === '') {
            this.updateSearchUI();
            this.render();
            return;
        }
        
        // Search through all spans
        for (const span of this.spans) {
            if (this.spanMatchesSearch(span, this.searchQuery)) {
                this.searchResults.push(span.spanId);
            }
        }
        
        // Sort results by span start time for consistent navigation
        this.searchResults.sort((a, b) => {
            const spanA = this.spanMap.get(a);
            const spanB = this.spanMap.get(b);
            return spanA.startTime - spanB.startTime;
        });
        
        // Auto-select first result
        if (this.searchResults.length > 0) {
            this.currentSearchIndex = 0;
            this.expandPathToSpan(this.searchResults[0]);
        }
        
        this.updateSearchUI();
        this.render();
        
        // Scroll to current result
        if (this.currentSearchIndex >= 0) {
            this.scrollToSpan(this.searchResults[this.currentSearchIndex]);
        }
    }
    
    spanMatchesSearch(span, query) {
        // Search in span name
        if (span.name.toLowerCase().includes(query)) return true;
        
        // Search in service name
        if (span.serviceName.toLowerCase().includes(query)) return true;
        
        // Search in span ID
        if (span.spanId.toLowerCase().includes(query)) return true;
        
        // Search in attributes
        for (const [key, value] of Object.entries(span.attributes)) {
            if (key.toLowerCase().includes(query)) return true;
            if (String(value).toLowerCase().includes(query)) return true;
        }
        
        return false;
    }
    
    handleSearchKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
                this.navigateSearch(-1);
            } else {
                this.navigateSearch(1);
            }
        } else if (event.key === 'Escape') {
            this.clearSearch();
        }
    }
    
    navigateSearch(direction) {
        if (this.searchResults.length === 0) return;
        
        this.currentSearchIndex += direction;
        
        // Wrap around
        if (this.currentSearchIndex >= this.searchResults.length) {
            this.currentSearchIndex = 0;
        } else if (this.currentSearchIndex < 0) {
            this.currentSearchIndex = this.searchResults.length - 1;
        }
        
        // Expand path to current span
        this.expandPathToSpan(this.searchResults[this.currentSearchIndex]);
        
        this.updateSearchUI();
        this.render();
        this.scrollToSpan(this.searchResults[this.currentSearchIndex]);
    }
    
    expandPathToSpan(spanId) {
        const span = this.spanMap.get(spanId);
        if (!span) return;
        
        // Find all ancestors and expand them
        let current = span;
        while (current.parentSpanId) {
            const parent = this.spanMap.get(current.parentSpanId);
            if (parent) {
                this.collapsedSpans.delete(parent.spanId);
                current = parent;
            } else {
                break;
            }
        }
    }
    
    scrollToSpan(spanId) {
        setTimeout(() => {
            const row = this.waterfallBody.querySelector(`[data-span-id="${spanId}"]`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 50);
    }
    
    clearSearch() {
        this.searchQuery = '';
        this.searchResults = [];
        this.currentSearchIndex = -1;
        this.searchInput.value = '';
        this.updateSearchUI();
        this.render();
    }
    
    updateSearchUI() {
        const hasResults = this.searchResults.length > 0;
        const hasQuery = this.searchQuery !== '';
        
        this.searchNav.classList.toggle('visible', hasQuery);
        
        if (hasQuery) {
            if (hasResults) {
                this.searchCount.textContent = `${this.currentSearchIndex + 1}/${this.searchResults.length}`;
            } else {
                this.searchCount.textContent = '0 results';
            }
        } else {
            this.searchCount.textContent = '';
        }
        
        this.searchPrevBtn.disabled = !hasResults;
        this.searchNextBtn.disabled = !hasResults;
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.traceVisualizer = new TraceVisualizer();
});
