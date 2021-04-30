(function (window, $) {

  /**
   * Private properties
   */
  var D3 = window.d3, topojson = window.topojson;

  // ad-hoc function mapping for various layers
  var _mapping = {
    'nation': renderPath,
    'states': renderPath,
    'counties': renderPath,
    'zones': renderPoint
  }

  var defaults = {
    location: '/',
    // elements
    element: null,  // container to which SVG will be added
    // sizes
    width: null,
    height: null,
    aspectRatio: null,
    // Data, can be initialized after
    data: null,
    // Geometries
    topography: null,
    topographyGranularity: null,
    extraLayers: [],
    topologyAdditions: null,
    // Color scheme
    colorScheme: 'qualitative',
    colorData: {0:'#cccccc', 1:'#777777'},
    // props
    labels: false,
    labelsFiltered: false,
    labelsSource: null,
    legend: true,
    legendTemplate: null,
    legendLabels: null,
    tooltip: true,
    tooltipTemplate: '<p>Name: [[name]]<br>Value: [[value]]</p>',
    callout: true,
    calloutElements: [],
    calloutElementTemplate: null,
    alterTopography: null,
    // Map positioning
    center: {x: 0.5, y:0.5},
    scaleFactor: 1,
  };

  var _path = '/', _topo = {
    'world': {
      world: {file: 'world.json', data: null},
      countries: {file: 'countries.json', data: null}
    },
    'us-atlas': {
      nation: {file: 'nation-10m.json', data: null},
      states: {file: 'states-10m.json', data: null},
      counties: {file: 'counties-10m.json', data: null}
    }
  };


  // --------------- Private methods -------------------------//

  function applyUnitClasses(unit, layerName) {
    var classes = [layerName, layerName + '--name-' + unit.properties.name.toLowerCase().replace(" ", "_")];
    if (unit.properties.hasOwnProperty('value')) {
      classes.push(layerName + '--value');
      classes.push(layerName + '--value-' + unit.properties.value);
    }
    return classes.join(' ');
  }

  function transformPointReversed(topology, position) {
    position = position.slice();
    position[0] = (position[0] - topology.transform.translate[0])
      /(topology.transform.scale[0]);
    position[1] = (position[1] - topology.transform.translate[1])
        /(topology.transform.scale[1]);
    return position;
  }

  /**
   * Unit render callback - path
   */
  function renderPath(layer, layerName, layerData) {
    var SELF = this;
    return layer.selectAll('path')
      .data(layerData)
      .enter().append('path')
      .attr('d', SELF.path)
      .attr('class', function (d) { return applyUnitClasses(d, layerName)})
      .style("fill", function (d) {
        return (d.properties.hasOwnProperty('value')) ? SELF.colorScale(d.properties.value) : null;
      });
  }

  /**
   * Unit render callback - point
   */
  function renderPoint(layer, layerName, layerData) {
    var SELF = this;
    return layer.selectAll('circle')
      .data(layerData)
      .enter().append('circle')
      .attr('r', function (d) {
        return '8px';
      })
      .attr('cx', function (d) {
        var
          c = d.geometry.coordinates,
          pos = SELF.projection(typeof d.latlong !== undefined ? transformPointReversed(SELF.options.topography, c) : c);
        return pos ? pos[0] : null;
      })
      .attr('cy', function (d) {
        var
          c = d.geometry.coordinates,
          pos = SELF.projection(typeof d.latlong !== undefined ? transformPointReversed(SELF.options.topography, c) : c);
        return pos ? pos[1] : null;
      })
      .style("fill", function (d) {
        return (d.properties.hasOwnProperty('value')) ? SELF.colorScale(d.properties.value) : null;
      });
  }

  function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }

  function mergeDeep(target, source) {
    let output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target))
            Object.assign(output, { [key]: source[key] });
          else
            output[key] = mergeDeep(target[key], source[key]);
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  /**
   * Computes mouse event coordinates relative to the choropleth container
   * @param event
   * @returns {{x: number, y: number}}
   */
  function getRelativeCoordinates(event) {
    return {
      x: event.pageX,
      y: event.pageY
    }
  }

  function calcCenterPoint(width, height) {
    return [
      (width ? width : this.options.width) * this.options.center.x,
      (height ? height : this.options.height) * this.options.center.y,
    ]
  }

  /**
   * Filters by property and value
   *
   * @param prop
   * @param value
   * @param obj
   * @returns {boolean}
   */
  function filterByProperty(prop, value, obj) {
    if (null !== value) {
      return obj.properties.hasOwnProperty(prop) && value === obj.properties[prop];
    }
    else {
      return obj.properties.hasOwnProperty(prop);
    }
  }

  /**
   * Fetches specified Topology data
   * @param name
   * @param layer
   * @returns {null|*}
   */
  function getTopography(name, layer) {
    var SELF = this;
    // When either set or layer is not defined
    if (!_topo.hasOwnProperty(name) || !_topo[name].hasOwnProperty(layer)) {
      return null;
    }

    // if we already have topography data loaded, just return it.
    if (_topo[name][layer].data) {
      return _topo[name][layer].data;
    }

    // Otherwise load data and return queue object
    return d3.queue().defer(function(cb) {
      d3.json(_path + 'topology/' + name + '/' + _topo[name][layer].file)
        .then(function(file) {
          if (typeof SELF.options.alterTopography === 'function') {
            SELF.options.alterTopography.call(SELF, file);
          }
          _topo[name][layer].data = file;
          cb(null,  _topo[name][layer].data);
        });
    });
  }

  /**
   * Adds data properties to topography features.
   * @returns {null}
   */
  function augmentTopography(topo, feature, data) {
    if (typeof topo !== 'object' || typeof data !== 'object') {
      return null;
    }
    if (!topo.objects.hasOwnProperty(feature)) {
      return topo;
    }
    for (var i = 0; i < topo.objects[feature].geometries.length; i++) {
      var id = Number(topo.objects[feature].geometries[i].id);
      if (data.hasOwnProperty(id)) {
        Object.assign(topo.objects[feature].geometries[i].properties, data[id]);
      }
    }
    return topo;
  }

  /**
   * Logging
   * @param msg Message to print
   * @param type Type of message
   */
  function message(msg, type) {
    type = type || 'info';
    msg = msg || false;
    if (msg) {
      msg = 'CHOROPLETH: ' + msg;
      console.log(msg);
      if ('error' === type) {
        throw new Error(msg)
      }
    }
  }

  /**
   * Applies defaults on top of provided settings object
   * @param obj
   * @returns {*}
   */
  //stolen from underscore.js
  function applyDefaults(obj) {
    Array.prototype.slice.call(arguments, 1).forEach(function(source) {
      if (source) {
        for (var prop in source) {
          // Deep copy if property not set
          if (obj[prop] == null) {
            if (typeof source[prop] == 'function') {
              obj[prop] = source[prop];
            }
            else {
              obj[prop] = JSON.parse(JSON.stringify(source[prop]));
            }
          }
        }
      }
    });
    return obj;
  }

  /**
   * Adds some extensions to D3
   */
  function extendD3() {
    // Moves selection to front
    d3.selection.prototype.moveToFront = function () {
      return this.each(function () {
        this.parentNode.appendChild(this);
      });
    };

    // Moves selection to back
    d3.selection.prototype.moveToBack = function () {
      return this.each(function () {
        var firstChild = this.parentNode.firstChild;
        if (firstChild) {
          this.parentNode.insertBefore(this, firstChild);
        }
      });
    };
  }

  /**
   * Returns color scale based on the settings provided
   * @param options
   * @returns {*}
   */
  function getColorScale(options) {
    var scale = null;

    // Check if custom call back is provided
    if (typeof options.colorScheme === 'function') {
      return options.colorScheme(options.colorData);
    }

    // Else go over available scheme types
    switch (options.colorScheme) {
      case 'ordinal':
        var domain = [], range = [];
        for (let idx in options.colorData) {
          if (options.colorData.hasOwnProperty(idx)) {
            domain.push(Number(idx));
            range.push(options.colorData[idx]);
          }
        }
        scale = d3.scaleOrdinal().domain(domain).range(range);
        break;
      case 'grayscale':
      case 'single-hue':
      case 'part-spectral':
      case 'full-spectral':
      case 'bipolar':
      default:
        scale = d3.scaleOrdinal().domain([-1, 0, 1, 2, 3, 4, 5]).range(d3.schemeBlues[7]);
        break;
    }
    return scale;
  }

  /**
   * Renders a template.
   * Substitutes tokens of format '[[token]]' with values from supplied data object
   *
   * @param tpl Template string
   * @param data Object with token:value pairs
   * @returns {*} Rendered string
   */
  function renderTemplate(tpl, data) {
    var processed = [];
    for (var match of tpl.matchAll(/\[\[([A-z0-9_]+)]]/g)) {
      if (processed.indexOf(match[1]) !== -1) {
        continue;
      }
      processed.push(match[1]);
      if (data.hasOwnProperty(match[1])) {
        tpl = tpl.replaceAll(match[0], data[match[1]]);
      }
    }
    return tpl;
  }

  /**
   * Choropleth class
   */
  function Choropleth(options) {

    var SELF = this;

    // Check requirements
    if (typeof d3 === undefined) {
      message('D3.js version 6.x is required.')
    }
    else if ( typeof topojson === undefined) {
      message('topojson is required.')
    }

    // D3 extensions
    extendD3();

    // Preprocess options
    options = options || {};
    this.options = applyDefaults(options, defaults);

    // Init svg
    if (!this.options.element || d3.select(this.options.element).empty()) {
      message('element does not exists', 'error');
    }
    this.EL = d3.select(this.options.element)

    this.SVG = this.EL.select('svg');
    if (this.SVG.empty()) {
      this.SVG = d3.select(this.options.element).append('svg');
    }

    // Calculate sizes
    if (this.options.aspectRatio) {
      this.EL
        .classed('choropleth--proportional', true)
        .select('.choropleth--wrapper')
        .style('padding-bottom', (this.options.aspectRatio * 100) + '%');
      this.options.width = this.EL.select('.choropleth--wrapper').node().getBoundingClientRect().width;
      this.options.height = this.EL.select('.choropleth--wrapper').node().getBoundingClientRect().height;
    }
    else {
      this.options.width = this.options.width || this.EL.node().getBoundingClientRect().width;
      this.options.height = this.options.height || this.EL.node().getBoundingClientRect().height;
      this.options.aspectRatio = this.options.height / this.options.width;
    }
    this.SVG
      .attr('width', this.options.width)
      .attr('height', this.options.height)
      .style('overflow', 'hidden');

    // Set projection, path and color scheme
    this.projection = d3.geoAlbersUsa().scale([this.options.width * this.options.scaleFactor]).translate(calcCenterPoint.call(SELF));
    this.path = d3.geoPath().projection(this.projection);
    this.colorScale = getColorScale(this.options);

    // add resizing
    d3.select(window).on('resize', this.resize.bind(this));

    // Save the above into options for reference
    this.options.projection = this.projection;
    this.options.path = this.path;
    this.options.colorScale = this.colorScale;

    // Each new choropleth instance can redefine location, so that topography
    // can be loaded from a custom source
    _path = this.options.location;

    // Pull topography and render the map.
    // ... when a string is supplied, we assume we need to load/provide topography
    if (typeof this.options.topography === 'string') {
      // Get topography
      var loaded = getTopography.call(SELF, this.options.topography, this.options.topographyGranularity);
      // If not yet loaded - an queue object is returned with 'await' method
      // Hook up to that method and wait for data to be loaded
      if (typeof loaded.await === 'function') {
        loaded.await(
          function(err, topography) {
            if (err) {
              throw err;
            }
            // replace topography option with loaded topography object
            topography = mergeDeep(topography, SELF.options.topologyAdditions);
            topography = augmentTopography(topography, SELF.options.topographyGranularity, SELF.options.data);
            SELF.options.topography = augmentTopography(topography, 'zones', SELF.options.data);
            _render();
          }
        );
      }
      // Otherwise, when data is readily available, just precede to render
      else {
        loaded = mergeDeep(loaded, SELF.options.topologyAdditions);
        loaded = augmentTopography(loaded, SELF.options.topographyGranularity, SELF.options.data);
        SELF.options.topography = augmentTopography(loaded, 'zones', SELF.options.data);
        _render();
      }

    }
    // ... otherwise, non-string value is assumed to be topography data ready to be rendered
    else {
      _render();
    }


    /**
     * Renders entire map.
     * This method is called from constructor
     * For updating map or rendering specific layer use proto methods
     */
    function _render() {
      message('rendering...');
      // render data layer
      SELF.drawDataLayer();
      SELF.drawDataLayer('zones');
      // render additional layers ?
      for (var i = 0; i <= SELF.options.extraLayers.length; i++) {
        SELF.drawLayer(SELF.options.extraLayers[i] );
      }
      // render labels
      if (SELF.options.labels) {
        SELF.drawLabels();
      }
      // render tooltips ()
      if (SELF.options.tooltip) {
        SELF.tooltip = d3.select('body').append('div').attr('class', 'choropleth--tooltip');
      }
      // render callouts
      // render legend
      if (SELF.options.legend) {
        SELF.legend = SELF.EL.append('dl').attr('class', 'choropleth--legend');
        SELF.updateLegend();
      }
    }
  }

  // Proxy to logging
  Choropleth.prototype.log = message;

  Choropleth.prototype.updateLegend = function () {
    if (!this.options.legend) {
      return;
    }

    // Legend varies based on the color scheme
    // @todo - determine the ways of generating various combinations of
    // scales and classifications

    // Render simple legend (ordinal)
    if (['qualitative'].indexOf(this.options.colorScheme)) {

      this.legend.attr('class', 'choropleth--legend choropleth--legend--' + this.options.colorScheme);
      for (var v of this.colorScale.domain()) {
        var c = this.colorScale(v),
            l = this.options.legendLabels.hasOwnProperty(v) ? this.options.legendLabels[v] : v.toString();

        this.legend.append('dt').attr('class', 'choropleth--legend-value').style('background-color', c);
        this.legend.append('dd').attr('class', 'choropleth--legend-label').html(l);

      }
      // this.legend
      //   .selectAll('dt')
      //   .data(this.colorScale.domain())
      //   .enter()
      //   .append('dt')
      //   .attr('data', this.colorScale)
      //   .;
      // el.append("g")
      //   .attr('class', 'layer layer--legend')
      //   .selectAll("rect")
      //   .data(colorScale.domain())
      //   .join("rect")
      //   .attr("x", x)
      //   .attr("y", 20)
      //   .attr("width", Math.max(0, x.bandwidth() - 1))
      //   .attr("height", 10)
      //   .attr("fill", colorScale);
      //
      // el.append("g")
      //   .attr("transform", `translate(0,32)`)
      //   .call(d3.axisBottom(x)
      //     .tickSize(0)
      //     .tickValues(null))
      //   .call(g => g.select(".domain").remove())
      //   .call(g => g.append("text")
      //     .attr("x", 5)
      //     .attr("y", 35)
      //     .attr("fill", "currentColor")
      //     .attr("text-anchor", "start")
      //     .attr("font-weight", "bold")
      //     .attr("font-size", "16")
      //     .attr("class", "title")
      //     .text('Legend'));

    }
    // Render band legend (band scale)
    else {

    }

  }

  /**
   * Resize callback
   */
  Choropleth.prototype.resize = function() {
    var SELF = this;
    // adjust things when the window size changes
    var width = this.EL.node().getBoundingClientRect().width,
        height = width * this.options.aspectRatio;

    // update projection
    this.projection.translate(calcCenterPoint.call(SELF, width, height)).scale([width * this.options.scaleFactor]);

    // resize the map container
    this.SVG
      .attr('width', width + 'px')
      .attr('height', height + 'px');

    // resize the map
    this.SVG.select('.layer--data').selectAll('path').attr('d', this.path);
  }

  /**
   * Draws a layer
   * Usually layer of topography features from the selected topography object
   * @param layer
   */
  Choropleth.prototype.drawLayer = function(layer) {
    // if (top.)
    this.SVG.append('g')
      .attr('class', 'layer layer--' + layer)
      .selectAll("path")
      .data(topojson.feature(us, us.objects[layer]).features)
      .enter().append("path")
      .attr("d", path)
      .attr('class', layer)
      .style("position", 'relative');
  }

  /**
   * Draws data layer of the map
   * @param layerName Optional
   */
  Choropleth.prototype.drawDataLayer = function(layerName) {
    layerName = layerName || this.options.topographyGranularity;

    var SELF = this, cb = _mapping[layerName];
    if (!SELF.options.topography.objects.hasOwnProperty(layerName)) {
      message('Data layer not found', 'warning');
      return;
    }

    var layer = SELF.SVG.append('g').attr('class', 'layer layer--data layer--' + layerName),
        layerData = topojson.feature(SELF.options.topography, SELF.options.topography.objects[layerName]).features;
    // Layer callback - ad-hoc and needs to be replaced
    layer = cb.call(SELF, layer, layerName, layerData);

    // Add tooltips
    if (SELF.options.tooltip) {
      layer
      .filter(filterByProperty.bind(null, 'value', null))
      .on("mouseover", function (e, obj) {
        var coords = getRelativeCoordinates.call(SELF, e);
        var sel = d3.select(this);
        sel.moveToFront()
          .transition()
          .duration(100)
          .style('opacity', '0.7');
        SELF.tooltip.html(renderTemplate(SELF.options.tooltipTemplate, obj.properties))
          .style('left', (coords.x + 15) + "px")
          .style('top', (coords.y + 18) + "px")
          .style('display', 'block');
      })
      .on("mouseout", function (e, obj) {
        var sel = d3.select(this);
        sel.moveToBack()
          .transition()
          .duration(100)
          .style('opacity', '1')
        SELF.tooltip.style('display', 'none');
      });
    }
  }

  /**
   * Draws labels on the map
   * @param name
   */
  Choropleth.prototype.drawLabels = function(name) {
    name = name || this.options.topographyGranularity;
    var SELF = this;
    // Draw parish name
    SELF.SVG.append('g')
      .attr('class', 'layer layer--labels')
      .selectAll('.label')
      .data(topojson.feature(SELF.options.topography, SELF.options.topography.objects[name]).features)
      .enter()
      .filter(filterByProperty.bind(null, 'value', null))
      .append('text')
      .each(function (d) {
        // Excluded labels
        // @todo make configurable
        if ("78" === d.id || "72" === d.id) {
          return null;
        }
        d3.select(this)
          .attr("transform", function (d) {
            return "translate(" + SELF.path.centroid(d) + ")";
          })
          // .attr("dx", "-3em")
          // .attr("dy", "-0.5em")
          .attr("fill", "black")
          .style("text-anchor", "middle")
          .text(function (d) {
            if (d.properties.hasOwnProperty(SELF.options.labelsSource)) {
              return d.properties[SELF.options.labelsSource];
            }
            else {
              return d.properties.name;
            }
          });
      });
  }

  window.Choropleth = Choropleth;
  window.ChoroplethAPI = {
    getInstance: getInstance,
  }

  function getInstance() {
    return null;
  }

})(window, jQuery);
