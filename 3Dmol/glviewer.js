//a molecular viewer based on GLMol



/**
 * WebGL-based 3Dmol.js viewer
 * Note: The preferred method of instantiating a GLViewer is through {@link $3Dmol.createViewer} 
 * 
 * @constructor 
 * @param {Object} element HTML element within which to create viewer
 * @param {function} callback - Callback function to be immediately executed on this viewer
 * @param {Object} defaultcolors - Object defining default atom colors as atom => color property value pairs for all models within this viewer
 */
$3Dmol.GLViewer = (function() {
	// private class variables
	var numWorkers = 4; // number of threads for surface generation
	var maxVolume = 64000; // how much to break up surface calculations

	// private class helper functions

	function GLViewer(element, callback, defaultcolors, nomouse) {
		// set variables
		var _viewer = this;
		var container = element;
		var id = container.id;

		var models = []; // atomistic molecular models
		var surfaces = [];
		var shapes = []; // Generic shapes
		var labels = [];
		var clickables = []; //things you can click on
		var WIDTH = container.width();
		var HEIGHT = container.height();

		// set dimensions
		// $(container).width(WIDTH);
		// $(container).height(HEIGHT);

		var ASPECT = WIDTH / HEIGHT;
		var NEAR = 1, FAR = 800;
		var CAMERA_Z = 150;
		var fov = 20;


		var renderer = new $3Dmol.Renderer({
			antialias : true
		});

		renderer.domElement.style.width = "100%";
		renderer.domElement.style.height = "100%";
		renderer.domElement.style.padding = "0";
		renderer.domElement.style.position = "absolute"; //TODO: get rid of this
		renderer.domElement.style.top = "0px";
		renderer.domElement.style.zIndex = "0";
		container.append(renderer.domElement);
		renderer.setSize(WIDTH, HEIGHT);
		var camera = new $3Dmol.Camera(fov, ASPECT, NEAR, FAR);
		camera.position = new $3Dmol.Vector3(0, 0, CAMERA_Z);
		var lookingAt = new $3Dmol.Vector3();
		camera.lookAt(lookingAt);

		var raycaster = new $3Dmol.Raycaster(new $3Dmol.Vector3(0, 0, 0),
				new $3Dmol.Vector3(0, 0, 0));
		var projector = new $3Dmol.Projector();
		var mouseVector = new $3Dmol.Vector3(0, 0, 0);

		var scene = null;
		var rotationGroup = null; // which contains modelGroup
		var modelGroup = null;

		var bgColor = 0x000000;
		var fogStart = 0.4;
		var slabNear = -50; // relative to the center of rotationGroup
		var slabFar = 50;

		// UI variables
		var cq = new $3Dmol.Quaternion(0, 0, 0, 1);
		var dq = new $3Dmol.Quaternion(0, 0, 0, 1);
		var isDragging = false;
		var mouseStartX = 0;
		var mouseStartY = 0;
		var touchDistanceStart = 0;
		var currentModelPos = 0;
		var cz = 0;
		var cslabNear = 0;
		var cslabFar = 0;

		var setSlabAndFog = function() {
			var center = camera.position.z - rotationGroup.position.z;
			if (center < 1)
				center = 1;
			camera.near = center + slabNear;
			if (camera.near < 1)
				camera.near = 1;
			camera.far = center + slabFar;
			if (camera.near + 1 > camera.far)
				camera.far = camera.near + 1;
			if (camera instanceof $3Dmol.Camera) {
				camera.fov = fov;
			} else {
				camera.right = center * Math.tan(Math.PI / 180 * fov);
				camera.left = -camera.right;
				camera.top = camera.right / ASPECT;
				camera.bottom = -camera.top;
			}
			camera.updateProjectionMatrix();
			scene.fog.near = camera.near + fogStart
					* (camera.far - camera.near);
			// if (scene.fog.near > center) scene.fog.near = center;
			scene.fog.far = camera.far;
		};

		// display scene
		var show = function() {
			if (!scene)
				return;

			// var time = new Date();
			setSlabAndFog();
			renderer.render(scene, camera);
			// console.log("rendered in " + (+new Date() - time) + "ms");
		};

		var initializeScene = function() {

			scene = new $3Dmol.Scene();
			scene.fog = new $3Dmol.Fog(bgColor, 100, 200);

			modelGroup = new $3Dmol.Object3D();
			rotationGroup = new $3Dmol.Object3D();
			rotationGroup.useQuaternion = true;
			rotationGroup.quaternion = new $3Dmol.Quaternion(0, 0, 0, 1);
			rotationGroup.add(modelGroup);

			scene.add(rotationGroup);

			// setup lights
			var directionalLight = new $3Dmol.Light(0xFFFFFF);
			directionalLight.position = new $3Dmol.Vector3(0.2, 0.2, 1)
					.normalize();
			directionalLight.intensity = 1.0;
			scene.add(directionalLight);
		};

		initializeScene();

		renderer.setClearColorHex(bgColor, 1.0);
		scene.fog.color = $3Dmol.CC.color(bgColor);

		var clickedAtom = null;
		// enable mouse support
		var glDOM = $(renderer.domElement);

		//regenerate the list of clickables
		var updateClickables = function() {
			clickables = [];
			var i, il;

			for (i = 0, il = models.length; i < il; i++) {
				var model = models[i];
				if(model) {
					var atoms = model.selectedAtoms({
						clickable : true
					});
					clickables = clickables.concat(atoms);
				}
			}

			for (i = 0, il = shapes.length; i < il; i++) {

				var shape = shapes[i];
				if (shape && shape.clickable) {
					clickables.push(shape);
				}
			}
		};
		
		// Checks for selection intersects on mousedown
		var handleClickSelection = function(mouseX, mouseY) {
			if(clickables.length == 0) return;
			var mouse = {
				x : mouseX,
				y : mouseY,
				z : -1.0
			};
			mouseVector.set(mouse.x, mouse.y, mouse.z);
			projector.unprojectVector(mouseVector, camera);
			mouseVector.sub(camera.position).normalize();

			raycaster.set(camera.position, mouseVector);

			var intersects = [];

			intersects = raycaster.intersectObjects(modelGroup, clickables);

			if (intersects.length) {
				var selected = intersects[0].clickable;
				if (selected.callback !== undefined
						&& typeof (selected.callback) === "function") {
					selected.callback(selected, _viewer);
				}
			}
		};

		var calcTouchDistance = function(ev) { // distance between first two
												// fingers
			var xdiff = ev.originalEvent.targetTouches[0].pageX
					- ev.originalEvent.targetTouches[1].pageX;
			var ydiff = ev.originalEvent.targetTouches[0].pageY
					- ev.originalEvent.targetTouches[1].pageY;
			return Math.sqrt(xdiff * xdiff + ydiff * ydiff);
		}
		
		//check targetTouches as well
		var getXY = function(ev) {
			var x = ev.pageX, y = ev.pageY;
			if (ev.originalEvent.targetTouches
					&& ev.originalEvent.targetTouches[0]) {
				x = ev.originalEvent.targetTouches[0].pageX;
				y = ev.originalEvent.targetTouches[0].pageY;
			}
			
			return [x,y];
		};

		//for a given screen (x,y) displacement return model displacement 
		var screenXY2model = function(x,y) {
			var dx = x/WIDTH;
			var dy = y/HEIGHT;
			var zpos = rotationGroup.position.z; 
			var q = rotationGroup.quaternion;						
			var t = new $3Dmol.Vector3(0,0,zpos);
			projector.projectVector(t, camera);
			t.x += dx*2;
			t.y -= dy*2;
			projector.unprojectVector(t, camera);
			t.z = 0;							
			t.applyQuaternion(q);
			return t;
		}
		
		if (!nomouse) {
			// user can request that the mouse handlers not be installed
			glDOM.bind('mousedown touchstart', function(ev) {
				ev.preventDefault();
				if (!scene)
					return;
				var xy = getXY(ev);
				var x = xy[0];
				var y = xy[1];
				
				if (x === undefined)
					return;
				isDragging = true;
				clickedAtom = null;
				mouseButton = ev.which;
				mouseStartX = x;
				mouseStartY = y;
				touchDistanceStart = 0;
				if (ev.originalEvent.targetTouches
						&& ev.originalEvent.targetTouches.length == 2) {
					touchDistanceStart = calcTouchDistance(ev);
				}
				cq = rotationGroup.quaternion;
				cz = rotationGroup.position.z;
				currentModelPos = modelGroup.position.clone();
				cslabNear = slabNear;
				cslabFar = slabFar;

			});

			glDOM.bind('DOMMouseScroll mousewheel', function(ev) { // Zoom
				ev.preventDefault();
				if (!scene)
					return;
				var scaleFactor = (CAMERA_Z - rotationGroup.position.z) * 0.85;
				if (ev.originalEvent.detail) { // Webkit
					rotationGroup.position.z += scaleFactor
							* ev.originalEvent.detail / 10;
				} else if (ev.originalEvent.wheelDelta) { // Firefox
					rotationGroup.position.z -= scaleFactor
							* ev.originalEvent.wheelDelta / 400;
				}
				if(rotationGroup.position.z > CAMERA_Z) rotationGroup.position.z = CAMERA_Z*0.999; //avoid getting stuck

				show();
			});

			glDOM.bind("contextmenu", function(ev) {
				ev.preventDefault();
			});
			$('body').bind('mouseup touchend', function(ev) {
				
				// handle selection
				if(isDragging && scene) { //saw mousedown, haven't moved
					var xy = getXY(ev);
					var x = xy[0];
					var y = xy[1];
					if(x == mouseStartX && y == mouseStartY) {					
						var mouseX = (x / $(window).width()) * 2 - 1;
						var mouseY = -(y / HEIGHT) * 2 + 1;
						handleClickSelection(mouseX, mouseY, ev, container);
					}
				}
				
				isDragging = false;

			});

			glDOM.bind('mousemove touchmove', function(ev) { // touchmove
				ev.preventDefault();
				if (!scene)
					return;
				if (!isDragging)
					return;
				var mode = 0;

				var xy = getXY(ev);
				var x = xy[0];
				var y = xy[1];
				if (x === undefined)
					return;
				var dx = (x - mouseStartX) / WIDTH;
				var dy = (y - mouseStartY) / HEIGHT;
				// check for pinch
				if (touchDistanceStart != 0
						&& ev.originalEvent.targetTouches
						&& ev.originalEvent.targetTouches.length == 2) {
					var newdist = calcTouchDistance(ev);
					// change to zoom
					mode = 2;
					dy = (touchDistanceStart - newdist) * 2
							/ (WIDTH + HEIGHT);
				} else if (ev.originalEvent.targetTouches
						&& ev.originalEvent.targetTouches.length == 3) {
					// translate
					mode = 1;
				}

				var r = Math.sqrt(dx * dx + dy * dy);
				var scaleFactor;
				if (mode == 3
						|| (mouseButton == 3 && ev.ctrlKey)) { // Slab
					slabNear = cslabNear + dx * 100;
					slabFar = cslabFar + dy * 100;
				} else if (mode == 2 || mouseButton == 3
						|| ev.shiftKey) { // Zoom
					scaleFactor = (CAMERA_Z - rotationGroup.position.z) * 0.85;
					if (scaleFactor < 80)
						scaleFactor = 80;
					rotationGroup.position.z = cz - dy
							* scaleFactor;
					if(rotationGroup.position.z > CAMERA_Z) rotationGroup.position.z = CAMERA_Z*0.999; //avoid getting stuck
				} else if (mode == 1 || mouseButton == 2
						|| ev.ctrlKey) { // Translate
					var t = screenXY2model(x-mouseStartX, y-mouseStartY);
					modelGroup.position.addVectors(currentModelPos,t);
					
				} else if ((mode === 0 || mouseButton == 1)
						&& r !== 0) { // Rotate
					var rs = Math.sin(r * Math.PI) / r;
					dq.x = Math.cos(r * Math.PI);
					dq.y = 0;
					dq.z = rs * dx;
					dq.w = -rs * dy;
					rotationGroup.quaternion = new $3Dmol.Quaternion(
							1, 0, 0, 0);
					rotationGroup.quaternion.multiply(dq);
					rotationGroup.quaternion.multiply(cq);
				}
				show();
			});
		}
		// public methods
		/**
		 * Set the background color (default white)
		 * 
		 * @function $3Dmol.GLViewer#setBackgroundColor
		 * @param {number}
		 *            hex Hexcode specified background color, or standard color spec
		 * @param {number}
		 *            a Alpha level (default 1.0)
		 * 
		 * @example
		 * 
		 * //Set 'myviewer' background color to white
		 * myviewer.setBackgroundColor(0xffffff)
		 * 
		 */
		this.setBackgroundColor = function(hex, a) {
			a = a | 1.0;
			var c = $3Dmol.CC.color(hex);
			scene.fog.color = c;
			bgColor = c.getHex();
			renderer.setClearColorHex(c.getHex(), a);
			show();
		};

		/**
		 * Set viewer width
		 * 
		 * @function $3Dmol.GLViewer#setWidth
		 * @param {number}
		 *            w Width in pixels
		 */
		this.setWidth = function(w) {
			WIDTH = w || WIDTH;
			renderer.setSize(WIDTH, HEIGHT);
		};

		/**
		 * Set viewer height
		 * 
		 * @function $3Dmol.GLViewer#setHeight
		 * @param {number}
		 *            h Height in pixels
		 */
		this.setHeight = function(h) {
			HEIGHT = h || HEIGHT;
			renderer.setSize(WIDTH, HEIGHT);
		};

		/**
		 * Resize viewer according to containing HTML element's dimensions
		 * 
		 * @function $3Dmol.GLViewer#resize
		 */
		this.resize = function() {
			WIDTH = container.width();
			HEIGHT = container.height();
			ASPECT = WIDTH / HEIGHT;
			renderer.setSize(WIDTH, HEIGHT);
			camera.aspect = ASPECT;
			camera.updateProjectionMatrix();
			show();
		};

		$(window).resize(this.resize);

		/**
		 * Return specified model
		 * 
		 * @function $3Dmol.GLViewer#getModel
		 * @param {number}
		 *            [id=last model id] - Retrieve model with specified id
		 * @default Returns last model added to viewer
		 * @return {GLModel}
		 * 
		 * @example // Retrieve reference to first GLModel added var m =
		 *          glviewer.getModel(0);
		 */
		this.getModel = function(id) {
			id = id || models.length - 1;
			return models[id];
		};

		/**
		 * Rotate scene by angle degrees around axis
		 * 
		 * @function $3Dmol.GLViewer#rotate
		 * @param {number}
		 *            [angle] - Angle, in degrees, to rotate by.
		 * @param {string}
		 *            [angle] - Axis ("x", "y", or "z") to rotate around.
		 *            Default "y"
		 * 
		 */
		this.rotate = function(angle, axis) {
			if (typeof (axis) === "undefined") {
				axis = "y";
			}
			var i = 0, j = 0, k = 0;
			var rangle = Math.PI * angle / 180.0;
			var s = Math.sin(rangle / 2.0);
			var c = Math.cos(rangle / 2.0);
			if (axis == "x")
				i = s;
			if (axis == "y")
				j = s;
			if (axis == "z")
				k = s;

			var q = new $3Dmol.Quaternion(i, j, k, c).normalize();
			rotationGroup.quaternion.multiply(q);
			show();
		};

		/** Returns an array representing the current viewpoint.
		 * Translation, zoom, and rotation quaternion. 
		 * @returns {Array.<number>} arg */
		this.getView = function() {
			if (!modelGroup)
				return [ 0, 0, 0, 0, 0, 0, 0, 1 ];
			var pos = modelGroup.position;
			var q = rotationGroup.quaternion;
			return [ pos.x, pos.y, pos.z, rotationGroup.position.z, q.x, q.y,
					q.z, q.w ];
		};

		/** Sets the view to the specified translation, zoom, and rotation. 
		 * @param {Array.<number>} arg */
		this.setView = function(arg) {

			if (arg === undefined
					|| !(arg instanceof Array || arg.length !== 8))
				return;

			if (!modelGroup || !rotationGroup)
				return;
			modelGroup.position.x = arg[0];
			modelGroup.position.y = arg[1];
			modelGroup.position.z = arg[2];
			rotationGroup.position.z = arg[3];
			rotationGroup.quaternion.x = arg[4];
			rotationGroup.quaternion.y = arg[5];
			rotationGroup.quaternion.z = arg[6];
			rotationGroup.quaternion.w = arg[7];
			if(typeof(arg[8]) != "undefined") {
				rotationGroup.position.x = arg[8];
				rotationGroup.position.y = arg[9];
			}
			show();
		};

		// apply styles, models, etc in viewer
		/**
		 * Render current state of viewer, after 
		 * adding/removing models, applying styles, etc.
		 * 
		 * @function $3Dmol.GLViewer#render
		 */
		this.render = function() {

			updateClickables(); //must render for clickable styles to take effect
			var time1 = new Date();
			var view = this.getView();
			
			var i;
			for (i = 0; i < models.length; i++) {
				if (models[i]) {
					models[i].globj(modelGroup);
				}
			}

			for (i = 0; i < shapes.length; i++) {
				if (shapes[i]) {
					shapes[i].globj(modelGroup);
				}
			}
			
			for (i in surfaces) { // this is an array with possible holes
				if (surfaces.hasOwnProperty(i)) {
					var geo = surfaces[i].geo;
					// async surface generation can cause
					// the geometry to be webgl initialized before it is fully
					// formed; force various recalculations until full surface
					// is
					// available
					if (!surfaces[i].finished) {
						geo.verticesNeedUpdate = true;
						geo.elementsNeedUpdate = true;
						geo.normalsNeedUpdate = true;
						geo.colorsNeedUpdate = true;
						geo.buffersNeedUpdate = true;
						geo.boundingSphere = null;

						if (surfaces[i].done)
							surfaces[i].finished = true;

						// remove partially rendered surface
						if (surfaces[i].lastGL)
							modelGroup.remove(surfaces[i].lastGL);

						// create new surface
						var smesh = null;

						if(surfaces[i].mat instanceof $3Dmol.LineBasicMaterial) {
							//special case line meshes
							smesh = new $3Dmol.Line(geo, surfaces[i].mat);
						}
						else {
							smesh = new $3Dmol.Mesh(geo, surfaces[i].mat);
						}
						if(surfaces[i].mat.transparent && surfaces[i].mat.opacity == 0) {
							//don't bother with hidden surfaces
							smesh.visible = false;
						} else {
							smesh.visible = true;
						}
						surfaces[i].lastGL = smesh;
						modelGroup.add(smesh);
					} // else final surface already there
				}
			}
			
			this.setView(view); // Calls show() => renderer render
			var time2 = new Date();
			//console.log("render time: " + (time2 - time1));
		};

		/**
		 * 
		 * @param {AtomSelectionSpec}
		 *            sel
		 * @return {AtomSpec[]}
		 */
		function getAtomsFromSel(sel) {
			var atoms = [];
			if (typeof (sel) === "undefined")
				sel = {};

			var ms = [];
			var i;

			if (typeof sel.model === "undefined") {
				for (i = 0; i < models.length; i++) {
					if (models[i])
						ms.push(models[i]);
				}
			} else { // specific to some models
				ms = sel.model;
				if (!$.isArray(ms))
					ms = [ ms ];
			}

			for (i = 0; i < ms.length; i++) {
				atoms = atoms.concat(ms[i].selectedAtoms(sel));
			}

			return atoms;
		}

		/**
		 * 
		 * @param {AtomSpec}
		 *            atom
		 * @param {AtomSpec}
		 *            sel
		 * @return {boolean}
		 */
		function atomIsSelected(atom, sel) {
			if (typeof (sel) === "undefined")
				sel = {};

			var ms = [];
			var i;

			if (typeof sel.model === "undefined") {
				for (i = 0; i < models.length; i++) {
					if (models[i])
						ms.push(models[i]);
				}
			} else { // specific to some models
				ms = sel.model;
				if (!$.isArray(ms))
					ms = [ ms ];
			}

			for (i = 0; i < ms.length; i++) {
				if (ms[i].atomIsSelected(atom, sel))
					return true;
			}

			return false;
		}

		/**
		 * Return pdb output of selected atoms (if atoms from pdb input)
		 * 
		 * @function $3Dmol.GLViewer#pdbData  
		 * @param {Object=} [sel] - Selection specification specifying model and atom properties to select.  Default: all atoms in viewer
		 * @return {string} PDB string of selected atoms
		 */
		this.pdbData = function(sel) {
			var atoms = getAtomsFromSel(sel);
			var ret = "";
			for (var i = 0, n = atoms.length; i < n; ++i) {
				ret += atoms[i].pdbline + "\n";
			}
			return ret;
		};

		/**
		 * Zoom current view by a constant factor
		 * 
		 * @function $3Dmol.GLViewer#zoom
		 * @param {number}
		 *            [factor] - Magnification factor. Values greater than 1
		 *            will zoom in, less than one will zoom out. Default 2.
		 * 
		 */
		this.zoom = function(factor) {
			var factor = factor || 2;
			var scale = (CAMERA_Z - rotationGroup.position.z) / factor;
			rotationGroup.position.z = CAMERA_Z - scale;
			show();
		};
		
		/**
		 * Translate current view by x,y screen coordinates
		 * This pans the camera rather than translating the model.
		 * 
		 * @function $3Dmol.GLViewer#translate
		 * @param {number} x
		 * @param {number} y
		 * 
		 */
		this.translate = function(x, y) {
			
			var dx = x/WIDTH;
			var dy = y/HEIGHT;
			var v = new $3Dmol.Vector3(0,0,-CAMERA_Z);

			projector.projectVector(v, camera);
			v.x -= dx;
			v.y -= dy;
			projector.unprojectVector(v, camera);
			v.z = 0;			
			lookingAt.add(v);
			camera.lookAt(lookingAt);
			show();
		};
		

		/**
		 * Zoom to center of atom selection
		 * 
		 * @function $3Dmol.GLViewer#zoomTo
		 * @param {Object}
		 *            [sel] - Selection specification specifying model and atom
		 *            properties to select. Default: all atoms in viewer
		 * @example // Assuming we have created a model of a protein with
		 *          multiple chains (e.g. from a PDB file), focus on atoms in
		 *          chain B glviewer.zoomTo({chain: 'B'});
		 *  // Focus on centroid of all atoms of all models in this
		 * viewer glviewer.zoomTo(); // (equivalent to glviewer.zoomTo({}) )
		 */
		this.zoomTo = function(sel) {
			var allatoms, alltmp;
			sel = sel || {};
			var atoms = getAtomsFromSel(sel);
			var tmp = $3Dmol.getExtent(atoms);

			if($.isEmptyObject(sel)) {
				//include shapes when zooming to full scene
				//TODO: figure out a good way to specify shapes as part of a selection
				$.each(shapes, function(i, shape) {
					atoms.push(shape);
				});
				allatoms = atoms;
				alltmp = tmp;

			}
			else {
				allatoms = getAtomsFromSel({});
				alltmp = $3Dmol.getExtent(allatoms);
			}

			// use selection for center
			var center = new $3Dmol.Vector3(tmp[2][0], tmp[2][1], tmp[2][2]);
			modelGroup.position = center.clone().multiplyScalar(-1);
			// but all for bounding box
			var x = alltmp[1][0] - alltmp[0][0], y = alltmp[1][1]
					- alltmp[0][1], z = alltmp[1][2] - alltmp[0][2];

			var maxD = Math.sqrt(x * x + y * y + z * z);
			if (maxD < 5)
				maxD = 5;

			// use full bounding box for slab/fog
			slabNear = -maxD / 1.9;
			slabFar = maxD / 2;

			// for zoom, use selection box
			x = tmp[1][0] - tmp[0][0];
			y = tmp[1][1] - tmp[0][1];
			z = tmp[1][2] - tmp[0][2];
			maxD = Math.sqrt(x * x + y * y + z * z);
			if (maxD < 5)
				maxD = 5;
			
			//find the farthest atom from center to get max distance needed for view
			var maxDsq = 25;
			for (var i = 0; i < atoms.length; i++) {
				if(atoms[i]) {
					var dsq = center.distanceToSquared(atoms[i]);
					if(dsq > maxDsq)
						maxDsq = dsq;
				}
			}
			
			var maxD = Math.sqrt(maxDsq)*2;

			rotationGroup.position.z = -(maxD * 0.5
					/ Math.tan(Math.PI / 180.0 * camera.fov / 2) - CAMERA_Z);

			show();
		};

		/**
		 * Add label to viewer
		 * 
		 * @function $3Dmol.GLViewer#addLabel
		 * @param {string}
		 *            text - Label text
		 * @param {Object}
		 *            data - Label style specification
		 * @return {$3Dmol.Label}
		 * 
		 * @example
		 *  // Assuming glviewer contains a model representing a protein, label
		 * all alpha carbons with their residue name
		 *  // Select all alpha carbons (have property atom : "CA") from last
		 * model added var atoms =
		 * glviewer.getModel().selectedAtoms({atom:"CA"}); var labels = [];
		 * 
		 * for (var a in atoms) { var atom = atoms[a];
		 *  // Create label at alpha carbon's position displaying atom's residue
		 * and residue number var labelText = atom.resname + " " + atom.resi;
		 * 
		 * var l = glviewer.createLabel(labelText, {fontSize: 12, position: {x:
		 * atom.x, y: atom.y, z: atom.z});
		 * 
		 * labels.push(l); }
		 *  // Render labels glviewer.render();
		 */
		this.addLabel = function(text, data) {
			var label = new $3Dmol.Label(text, data);
			label.setContext();
			modelGroup.add(label.sprite);
			labels.push(label);
			show();
			return label;
		};
		
		/** Add residue labels.  This will generate one label per a
		 * residue within the selected atoms.  The label will be at the
		 * centroid of the atoms and styled according to the passed style.
		 * The label text will be [resn][resi]
		 * 
		 * @param {Object} sel
		 * @param {Object} style
		 */
        this.addResLabels = function(sel, style) {
			applyToModels("addResLabels", sel, this, style);
        }

		/**
		 * Remove label from viewer
		 * 
		 * @function $3Dmol.GLViewer#removeLabel
		 * @param {$3Dmol.Label}
		 *            label - $3Dmol label
		 * 
		 * @example // Remove labels created in [addLabel example]{@link $3Dmol.GLViewer#addLabel}
		 * 
		 * for (var i = 0; i < labels.length; i++) {
		 * glviewer.removeLabel(label); }
		 * 
		 * glviewer.render();
		 */
		this.removeLabel = function(label) {
			//todo: don't do the linear search
			for(var i = 0; i < labels.length; i++) {
				if(labels[i] == label) {
					labels.splice(i,1);
					break;
				}
			}
			label.dispose();
			modelGroup.remove(label.sprite);
		};

		/**
		 * Remove all labels from viewer
		 * 
		 * @function $3Dmol.GLViewer#removeAllLabels

		 */
		this.removeAllLabels = function() {
			for (var i = 0; i < labels.length; i++) {
				modelGroup.remove(labels[i].sprite);
			}
			labels = [];
		};
		
		// Modify label style
		/**
		 * Modify existing label's style
		 * 
		 * @function $3Dmol.GLViewer#setLabelStyle
		 * @param {$3Dmol.Label}
		 *            label - $3Dmol label
		 * @param {Object}
		 *            stylespec - Label style specification
		 * @return {$3Dmol.Label}
		 */
		this.setLabelStyle = function(label, stylespec) {
			modelGroup.remove(label.sprite);
			label.dispose();
			label.stylespec = stylespec;
			label.setContext();
			modelGroup.add(label.sprite);
			show();
			return label;

		};

		// Change label text
		/**
		 * Modify existing label's text
		 * 
		 * @function $3Dmol.GLViewer#setLabelText
		 * @param {$3Dmol.Label}
		 *            label - $3Dmol label
		 * @param {String}
		 *            text - Label text
		 * @return {$3Dmol.Label}
		 */
		this.setLabelText = function(label, text) {
			modelGroup.remove(label.sprite);
			label.dispose();
			label.text = text;
			label.setContext();
			modelGroup.add(label.sprite);
			show();
			return label;

		};

		/**
		 * Add shape object to viewer 
		 * @see {@link $3Dmol.GLShape}
		 * 
		 * @function $3Dmol.GLViewer#addShape
		 * @param {ShapeSpec} shapeSpec - style specification for label
		 * @return {$3Dmol.GLShape}
		 */
		this.addShape = function(shapeSpec) {
			shapeSpec = shapeSpec || {};
			var shape = new $3Dmol.GLShape(shapeSpec);
			shape.shapePosition = shapes.length;
			shapes.push(shape);

			return shape;

		};

		/**
		 * Remove shape object from viewer
		 *
		 * @function $3Dmol.GLViewer#removeShape
		 * @param {$3Dmol.GLShape} shape - Reference to shape object to remove
		 */
		this.removeShape = function(shape) {
			if (!shape)
				return;
			shape.removegl(modelGroup);
			delete shapes[shape.shapePosition];
			// clear off back of model array
			while (shapes.length > 0
					&& typeof (shapes[shapes.length - 1]) === "undefined")
				shapes.pop();
		};
		
		/**
		 * Remove all shape objects from viewer
		 * @function $3Dmol.GLViewer#removeAllShapes
		 */
		this.removeAllShapes = function() {
			for (var i = 0; i < shapes.length; i++) {
				var shape = shapes[i];
				shape.removegl(modelGroup);
			}
			shapes = [];
		}

		/**
		 * Create and add sphere shape. This method provides a shorthand 
		 * way to create a spherical shape object
		 * 
		 * @function $3Dmol.GLViewer#addSphere
		 * @param {SphereSpec} spec - Sphere shape style specification
		 * @return {$3Dmol.GLShape}
		 */
		this.addSphere = function(spec) {
			spec = spec || {};
			var s = new $3Dmol.GLShape(spec);
			s.shapePosition = shapes.length;
			s.addSphere(spec);
			shapes.push(s);

			return s;
		};

		/**
		 * Create and add arrow shape
		 * 
		 * @function $3Dmol.GLViewer#addArrow
		 * @param {ArrowSpec} spec - Style specification
		 * @return {$3Dmol.GLShape}
		 */
		this.addArrow = function(spec) {
			spec = spec || {};
			var s = new $3Dmol.GLShape(spec);
			s.shapePosition = shapes.length;
			s.addArrow(spec);
			shapes.push(s);

			return s;
		};
		
		/**
		 * Create and add cylinder shape
		 * 
		 * @function $3Dmol.GLViewer#addArrow
		 * @param {CylinderSpec} spec - Style specification
		 * @return {$3Dmol.GLShape}
		 */
		this.addCylinder = function(spec) {
			spec = spec || {};
			var s = new $3Dmol.GLShape(spec);
			s.shapePosition = shapes.length;
			s.addCylinder(spec);
			shapes.push(s);

			return s;
		};

		/**
		 * Add custom shape component from user supplied function
		 * 
		 * @function $3Dmol.GLViewer#addCustom
		 * @param {CustomSpec} spec - Style specification
		 * @return {$3Dmol.GLShape}
		 */
		this.addCustom = function(spec) {
			spec = spec || {};
			var s = new $3Dmol.GLShape(spec);
			s.shapePosition = shapes.length;
			s.addCustom(spec);
			shapes.push(s);

			return s;
		};

		/**
		 * Construct isosurface from volumetric data in gaussian cube format
		 * 
		 * @function $3Dmol.GLViewer#addVolumetricData
		 * @param {String} data - Input file contents 
		 * @param {String} format - Input file format (currently only supports "cube")
		 * @param {VolSpec} spec - Shape style specification
		 * @return {$3Dmol.GLShape}
		 */
		this.addVolumetricData = function(data, format, spec) {
			spec = spec || {};
			var s = new $3Dmol.GLShape(spec);
			s.shapePosition = shapes.length;
			s.addVolumetricData(data, format, spec);
			shapes.push(s);

			return s;
		};

		/**
		 * Create and add model to viewer, given molecular data and its format 
		 * (pdb, sdf, xyz, or mol2)
		 * 
		 * @function $3Dmol.GLViewer#addModel
		 * @param {string} data - Input data
		 * @param {string} format - Input format ('pdb', 'sdf', 'xyz', or 'mol2')
		 * @return {$3Dmol.GLModel}
		 */
		this.addModel = function(data, format, options) {

			var m = new $3Dmol.GLModel(models.length, defaultcolors);
			m.addMolData(data, format, options);
			models.push(m);

			return m;
		};

		/**
		 * Delete specified model from viewer
		 * 
		 * @function $3Dmol.GLViewer#removeModel
		 * @param {$3Dmol.GLModel} model
		 */
		this.removeModel = function(model) {
			if (!model)
				return;
			model.removegl(modelGroup);
			delete models[model.getID()];
			// clear off back of model array
			while (models.length > 0
					&& typeof (models[models.length - 1]) === "undefined")
				models.pop();
		};

		/** 
		 * Delete all existing models
		 * @function $3Dmol.GLViewer#removeAllModels
		 */
		this.removeAllModels = function() {
			for (var i = 0; i < models.length; i++) {
				var model = models[i];
				model.removegl(modelGroup);

			}
			models = [];
		};

		/**
		 * Create a new model from atoms specified by sel.
		 * If extract, removes selected atoms from existing models 
		 * 
		 * @function $3Dmol.GLViewer#createModelFrom
		 * @param {Object} sel - Atom selection specification
		 * @param {boolean=} extract - If true, remove selected atoms from existing models
		 * @return {$3Dmol.GLModel}
		 */
		this.createModelFrom = function(sel, extract) {
			var m = new $3Dmol.GLModel(models.length, defaultcolors);
			for (var i = 0; i < models.length; i++) {
				if (models[i]) {
					var atoms = models[i].selectedAtoms(sel);
					m.addAtoms(atoms);
					if (extract)
						models[i].removeAtoms(atoms);
				}
			}
			models.push(m);
			return m;
		};

		function applyToModels(func, sel, value1, value2) {
			for (var i = 0; i < models.length; i++) {
				if (models[i]) {
					models[i][func](sel, value1, value2);
				}
			}
		}

		/**
		 * Set style properties to all selected atoms
		 * 
		 * @function $3Dmol.GLViewer#setStyle
		 * @param {AtomSelectionSpec} sel - Atom selection specification
		 * @param {AtomStyleSpec} style - Style spec to apply to specified atoms
		 * 
		 * @example
		 * viewer.setStyle({}, {stick:{}}); //set all atoms to stick
		 * viewer.setStyle({chain: 'B'}, {carton: {color: spectrum}}); //set chain B to rainbow cartoon
		 */
		this.setStyle = function(sel, style) {
			applyToModels("setStyle", sel, style, false);
		};

		/**
		 * Add style properties to all selected atoms
		 * 
		 * @function $3Dmol.GLViewer#addStyle
		 * @param {AtomSelectionSpec} sel - Atom selection specification
		 * @param {AtomStyleSpec} style - style spec to add to specified atoms
		 */
		this.addStyle = function(sel, style) {
			applyToModels("setStyle", sel, style, true);
		};

		/**
		 * @function $3Dmol.GLViewer#setColorByProperty
		 * @param {AtomSelectionSpec} sel
		 * @param {type} prop
		 * @param {type} scheme
		 */
		this.setColorByProperty = function(sel, prop, scheme) {
			applyToModels("setColorByProperty", sel, prop, scheme);
		};

		/**
		 * @function $3Dmol.GLViewer#setColorByElement
		 * @param {AtomSelectionSpec} sel
		 * @param {type} colors
		 */
		this.setColorByElement = function(sel, colors) {
			applyToModels("setColorByElement", sel, colors);
		};

		/**
		 * 
		 * @param {AtomSpec[]} atomlist
		 * @param {Array}
		 *            extent
		 * @return {Array}
		 */
		var getAtomsWithin = function(atomlist, extent) {
			var ret = [];

			for (var i = 0; i < atomlist.length; i++) {
				var atom = atomlist[i];
				if (typeof (atom) == "undefined")
					continue;

				if (atom.x < extent[0][0] || atom.x > extent[1][0])
					continue;
				if (atom.y < extent[0][1] || atom.y > extent[1][1])
					continue;
				if (atom.z < extent[0][2] || atom.z > extent[1][2])
					continue;
				ret.push(i);
			}
			return ret;
		};

		// return volume of extent
		var volume = function(extent) {
			var w = extent[1][0] - extent[0][0];
			var h = extent[1][1] - extent[0][1];
			var d = extent[1][2] - extent[0][2];
			return w * h * d;
		}; // volume
		/*
		 * Break up bounding box/atoms into smaller pieces so we can parallelize
		 * with webworkers and also limit the size of the working memory Returns
		 * a list of bounding boxes with the corresponding atoms. These extents
		 * are expanded by 4 angstroms on each side.
		 */
		/**
		 * 
		 * @param {Array}
		 *            extent
		 * @param {AtomSpec[]} atomlist
		 * @param {AtomSpec[]} atomstoshow
		 * @return {Array}
		 */
		var carveUpExtent = function(extent, atomlist, atomstoshow) {
			var ret = [];

			var copyExtent = function(extent) {
				// copy just the dimensions
				var ret = [];
				ret[0] = [ extent[0][0], extent[0][1], extent[0][2] ];
				ret[1] = [ extent[1][0], extent[1][1], extent[1][2] ];
				return ret;
			}; // copyExtent
			var splitExtentR = function(extent) {
				// recursively split until volume is below maxVol
				if (volume(extent) < maxVolume) {
					return [ extent ];
				} else {
					// find longest edge
					var w = extent[1][0] - extent[0][0];
					var h = extent[1][1] - extent[0][1];
					var d = extent[1][2] - extent[0][2];

					var index;

					if (w > h && w > d) {
						index = 0;
					} else if (h > w && h > d) {
						index = 1;
					} else {
						index = 2;
					}

					// create two halves, splitting at index
					var a = copyExtent(extent);
					var b = copyExtent(extent);
					var mid = (extent[1][index] - extent[0][index]) / 2
							+ extent[0][index];
					a[1][index] = mid;
					b[0][index] = mid;

					var alist = splitExtentR(a);
					var blist = splitExtentR(b);
					return alist.concat(blist);
				}
			}; // splitExtentR

			// divide up extent
			var splits = splitExtentR(extent);
			// now compute atoms within expanded (this could be more efficient)
			var off = 6; // enough for water and 2*r, also depends on scale
			// factor
			for (var i = 0, n = splits.length; i < n; i++) {
				var e = copyExtent(splits[i]);
				e[0][0] -= off;
				e[0][1] -= off;
				e[0][2] -= off;
				e[1][0] += off;
				e[1][1] += off;
				e[1][2] += off;

				var atoms = getAtomsWithin(atomlist, e);
				var toshow = getAtomsWithin(atomstoshow, splits[i]);

				// ultimately, divide up by atom for best meshing
				ret.push({
					extent : splits[i],
					atoms : atoms,
					toshow : toshow
				});
			}

			return ret;
		};

		// create a mesh defined from the passed vertices and faces and material
		// Just create a single geometry chunk - broken up whether sync or not
		/**
		 * 
		 * @param {AtomSpec[]} atoms
		 * @param {{vertices:number,faces:number}}
		 *            VandF
		 * @param {$3Dmol.MeshLambertMaterial}
		 *            mat
		 * @return {$3Dmol.Mesh}
		 */
		var generateSurfaceMesh = function(atoms, VandF, mat) {

			var geo = new $3Dmol.Geometry(true);
			// Only one group per call to generate surface mesh (addSurface
			// should split up mesh render)
			var geoGroup = geo.updateGeoGroup(0);

			var vertexArray = geoGroup.vertexArray;
			// reconstruct vertices and faces
			var v = VandF['vertices'];
			var offset;
			var i, il;
			for (i = 0, il = v.length; i < il; i++) {
				offset = geoGroup.vertices * 3;
				vertexArray[offset] = v[i].x;
				vertexArray[offset + 1] = v[i].y;
				vertexArray[offset + 2] = v[i].z;
				geoGroup.vertices++;
			}

			var faces = VandF['faces'];
			geoGroup.faceidx = faces.length;// *3;
			geo.initTypedArrays();

			// set colors for vertices
			var colors = [];
			for (i = 0, il = atoms.length; i < il; i++) {
				var atom = atoms[i];
				if (atom) {
					if (typeof (atom.surfaceColor) != "undefined") {
						colors[i] = atom.surfaceColor;
					} else if (atom.color) // map from atom
						colors[i] = $3Dmol.CC.color(atom.color);
				}
			}

			var verts = geoGroup.vertexArray;
			var colorArray = geoGroup.colorArray;
			var normalArray = geoGroup.normalArray;
			var vA, vB, vC, norm;

			// Setup colors, faces, and normals
			for (i = 0, il = faces.length; i < il; i += 3) {

				// var a = faces[i].a, b = faces[i].b, c = faces[i].c;
				var a = faces[i], b = faces[i + 1], c = faces[i + 2];
				var A = v[a]['atomid'];
				var B = v[b]['atomid'];
				var C = v[c]['atomid'];

				var offsetA = a * 3, offsetB = b * 3, offsetC = c * 3;

				colorArray[offsetA] = colors[A].r;
				colorArray[offsetA + 1] = colors[A].g;
				colorArray[offsetA + 2] = colors[A].b;
				colorArray[offsetB] = colors[B].r;
				colorArray[offsetB + 1] = colors[B].g;
				colorArray[offsetB + 2] = colors[B].b;
				colorArray[offsetC] = colors[C].r;
				colorArray[offsetC + 1] = colors[C].g;
				colorArray[offsetC + 2] = colors[C].b;

				// setup Normals

				vA = new $3Dmol.Vector3(verts[offsetA], verts[offsetA + 1],
						verts[offsetA + 2]);
				vB = new $3Dmol.Vector3(verts[offsetB], verts[offsetB + 1],
						verts[offsetB + 2]);
				vC = new $3Dmol.Vector3(verts[offsetC], verts[offsetC + 1],
						verts[offsetC + 2]);

				vC.subVectors(vC, vB);
				vA.subVectors(vA, vB);
				vC.cross(vA);

				// face normal
				norm = vC;
				norm.normalize();

				normalArray[offsetA] += norm.x;
				normalArray[offsetB] += norm.x;
				normalArray[offsetC] += norm.x;
				normalArray[offsetA + 1] += norm.y;
				normalArray[offsetB + 1] += norm.y;
				normalArray[offsetC + 1] += norm.y;
				normalArray[offsetA + 2] += norm.z;
				normalArray[offsetB + 2] += norm.z;
				normalArray[offsetC + 2] += norm.z;

			}
			geoGroup.faceArray = new Uint16Array(faces);
			var mesh = new $3Dmol.Mesh(geo, mat);
			mesh.doubleSided = true;

			return mesh;
		};

		// do same thing as worker in main thread
		/**
		 * 
		 * @param {$3Dmol.SurfaceType}
		 *            type
		 * @param {Array}
		 *            expandedExtent
		 * @param {Array}
		 *            extendedAtoms
		 * @param {Array}
		 *            atomsToShow
		 * @param {AtomSpec[]} atoms
		 * @param {number}
		 *            vol
		 * @return {Object}
		 */
		var generateMeshSyncHelper = function(type, expandedExtent,
				extendedAtoms, atomsToShow, atoms, vol) {
			var time = new Date();
			var ps = new $3Dmol.ProteinSurface();
			ps.initparm(expandedExtent, (type === 1) ? false : true, vol);

			var time2 = new Date();
			//console.log("initialize " + (time2 - time) + "ms");

			ps.fillvoxels(atoms, extendedAtoms);

			var time3 = new Date();
			//console.log("fillvoxels " + (time3 - time2) + "  " + (time3 - time) + "ms");

			ps.buildboundary();

			if (type == $3Dmol.SurfaceType.SES) {
				ps.fastdistancemap();
				ps.boundingatom(false);
				ps.fillvoxelswaals(atoms, extendedAtoms);
			}

			var time4 = new Date();
			console.log("buildboundaryetc " + (time4 - time3) + "  "
					+ (time4 - time) + "ms");

			ps.marchingcube(type);

			var time5 = new Date();
			//console.log("marching cube " + (time5 - time4) + "  "+ (time5 - time) + "ms");

			return ps.getFacesAndVertices(atomsToShow);
		};

		/**
		 * 
		 * @param {matSpec}
		 *            style
		 * @return {$3Dmol.MeshLambertMaterial}
		 */
		function getMatWithStyle(style) {
			var mat = new $3Dmol.MeshLambertMaterial();
			mat.vertexColors = $3Dmol.VertexColors;

			for ( var prop in style) {
				if (prop === "color" || prop === "map") {
					// ignore
				} else if (style.hasOwnProperty(prop))
					mat[prop] = style[prop];
			}
			if (style.opacity !== undefined) {
				if (style.opacity === 1)
					mat.transparent = false;
				else
					mat.transparent = true;
			}

			return mat;
		}

		// get the min and max values of the specified property in the provided
		// atoms
		function getPropertyRange(atomlist, prop) {
			var min = Number.POSITIVE_INFINITY;
			var max = Number.NEGATIVE_INFINITY;

			for (var i = 0, n = atomlist.length; i < n; i++) {
				var atom = atomlist[i];
				if (atom.properties
						&& typeof (atom.properties[prop]) != "undefined") {
					var val = atom.properties[prop];
					if (val < min)
						min = val;
					if (val > max)
						max = val;
				}
			}

			if (!isFinite(min) && !isFinite(max))
				min = max = 0;
			else if (!isFinite(min))
				min = max;
			else if (!isFinite(max))
				max = min;

			return [ min, max ];
		}

		
		/**
		 * Adds an explicit mesh as a surface object.
		 * 
		 * @param {$3Dmol.Mesh}
		 *            mesh
		 * @param {Object}
		 *            style
		 * @returns {Number} surfid
		 */
		this.addMesh = function(mesh) {
			var surfobj = {
				geo : mesh.geometry,
				mat : mesh.material,
				done : true,
				finished : false //the rendered finishes surfaces when they are done
			};
			var surfid = surfaces.length;
			surfaces[surfid] = surfobj;
			return surfid;
		}

		//return a shallow copy of list l, e.g., for atoms so we can
		//ignore superficial changes (ie surfacecolor, position) that happen
		//while we're surface building
		var shallowCopy = function(l) {
			var ret = [];
			$.each(l, function(k,v) {
				ret[k] = $.extend({},v);
			});
			return ret;
		}
		/**
		 * Add surface representation to atoms
		 *  @function $3Dmol.GLViewer#addSurface
		 * @param {$3Dmol.SurfaceType} type - Surface type
		 * @param {Object} style - optional style specification for surface material (e.g. for different coloring scheme, etc)
		 * @param {AtomSelectionSpec} atomsel - Show surface for atoms in this selection
		 * @param {AtomSelectionSpec} allsel - Use atoms in this selection to calculate surface; may be larger group than 'atomsel' 
		 * @param {AtomSelectionSpec} focus - Optionally begin rendering surface specified atoms
		 * 
		 * @return {number} surfid - Identifying number for this surface
		 */
		this.addSurface = function(type, style, atomsel, allsel, focus) {
			// type 1: VDW 3: SAS 4: MS 2: SES
			// if sync is true, does all work in main thread, otherwise uses
			// workers
			// with workers, must ensure group is the actual modelgroup since
			// surface
			// will get added asynchronously
			// all atoms in atomlist are used to compute surfaces, but only the
			// surfaces
			// of atomsToShow are displayed (e.g., for showing cavities)
			// if focusSele is specified, will start rending surface around the
			// atoms specified by this selection
			var atomlist = null, focusSele = null;
			var atomsToShow = shallowCopy(getAtomsFromSel(atomsel));
			if(!allsel) {
				atomlist = atomsToShow;
			}
			else {
				atomlist = shallowCopy(getAtomsFromSel(allsel));
			}
			
			if(!focus) {
				focusSele = atomsToShow;
			} else {
				focusSele = shallowCopy(getAtomsFromSel(focus));
			}

			var atom;
			style = style || {};

			var time = new Date();

			var mat = getMatWithStyle(style);

			var extent = $3Dmol.getExtent(atomsToShow);

			var i, il;
			if (style['map'] && style['map']['prop']) {
				// map color space using already set atom properties
				/** @type {AtomSpec} */
				var prop = style['map']['prop'];
				/** @type {Gradient} */
				var scheme = style['map']['scheme'] || new $3Dmol.Gradient.RWB();
				var range = scheme.range();
				if (!range) {
					range = getPropertyRange(atomsToShow, prop);
				}

				for (i = 0, il = atomsToShow.length; i < il; i++) {
					atom = atomsToShow[i];
					atom.surfaceColor = $3Dmol.CC.color(scheme.valueToHex(
							atom.properties[prop], range));
				}
			}
			else if(typeof(style['color']) != 'undefined') {
				//explicitly set color, otherwise material color just blends
				for (i = 0, il = atomsToShow.length; i < il; i++) {
					atom = atomsToShow[i];
					atom.surfaceColor = $3Dmol.CC.color(style['color']);
				}
			}
			else if(typeof(style['colorscheme']) != 'undefined') {
				for (i = 0, il = atomsToShow.length; i < il; i++) {
					atom = atomsToShow[i];
					var scheme = $3Dmol.elementColors[style.colorscheme];
	            	if(scheme && typeof(scheme[atom.elem]) != "undefined") {
						atom.surfaceColor = $3Dmol.CC.color(scheme[atom.elem]);
	            	}
				}
			}

			var totalVol = volume(extent); // used to scale resolution
			var extents = carveUpExtent(extent, atomlist, atomsToShow);

			if (focusSele && focusSele.length && focusSele.length > 0) {
				var seleExtent = $3Dmol.getExtent(focusSele);
				// sort by how close to center of seleExtent
				var sortFunc = function(a, b) {
					var distSq = function(ex, sele) {
						// distance from e (which has no center of mass) and
						// sele which does
						var e = ex.extent;
						var x = e[1][0] - e[0][0];
						var y = e[1][1] - e[0][1];
						var z = e[1][2] - e[0][2];
						var dx = (x - sele[2][0]);
						dx *= dx;
						var dy = (y - sele[2][1]);
						dy *= dy;
						var dz = (z - sele[2][2]);
						dz *= dz;

						return dx + dy + dz;
					};
					var d1 = distSq(a, seleExtent);
					var d2 = distSq(b, seleExtent);
					return d1 - d2;
				};
				extents.sort(sortFunc);
			}

			//console.log("Extents " + extents.length + "  "+ (+new Date() - time) + "ms");

			var surfobj = {
				geo : new $3Dmol.Geometry(true),
				mat : mat,
				done : false,
				finished : false
			// also webgl initialized
			};
			var surfid = surfaces.length;
			surfaces[surfid] = surfobj;
			var reducedAtoms = [];
			// to reduce amount data transfered, just pass x,y,z,serial and elem
			for (i = 0, il = atomlist.length; i < il; i++) {
				atom = atomlist[i];
				reducedAtoms[i] = {
					x : atom.x,
					y : atom.y,
					z : atom.z,
					serial : i,
					elem : atom.elem
				};
			}

			var sync = !!($3Dmol.syncSurface);
			if (sync) { // don't use worker, still break up for memory purposes

				// to keep the browser from locking up, call through setTimeout
				var callSyncHelper = function callSyncHelper(i) {
					if (i >= extents.length)
						return;

					var VandF = generateMeshSyncHelper(type, extents[i].extent,
							extents[i].atoms, extents[i].toshow, reducedAtoms,
							totalVol);
					var mesh = generateSurfaceMesh(atomlist, VandF, mat);
					$3Dmol.mergeGeos(surfobj.geo, mesh);
					_viewer.render();

					setTimeout(callSyncHelper, 1, i + 1);
				}

				setTimeout(callSyncHelper, 1, 0);

				// TODO: Asynchronously generate geometryGroups (not separate
				// meshes) and merge them into a single geometry
			} else { // use worker

				var workers = [];
				if (type < 0)
					type = 0; // negative reserved for atom data
				for (i = 0, il = numWorkers; i < il; i++) {
					// var w = new Worker('3Dmol/SurfaceWorker.js');
					var w = new Worker($3Dmol.SurfaceWorker);
					workers.push(w);
					w.postMessage({
						'type' : -1,
						'atoms' : reducedAtoms,
						'volume' : totalVol
					});
				}
				var cnt = 0;

				var rfunction = function(event) {
					var VandF = event.data;
					var mesh = generateSurfaceMesh(atomlist, VandF, mat);
					$3Dmol.mergeGeos(surfobj.geo, mesh);
					_viewer.render();
				//	console.log("async mesh generation " + (+new Date() - time) + "ms");
					cnt++;
					if (cnt == extents.length)
						surfobj.done = true;
				};

				var efunction = function(event) {
					console.log(event.message + " (" + event.filename + ":" + event.lineno + ")");
				};

				for (i = 0; i < extents.length; i++) {
					var worker = workers[i % workers.length];
					worker.onmessage = rfunction;

					worker.onerror = efunction;

					worker.postMessage({
						'type' : type,
						'expandedExtent' : extents[i].extent,
						'extendedAtoms' : extents[i].atoms,
						'atomsToShow' : extents[i].toshow
					});
				}
			}

			// NOTE: This is misleading if 'async' mesh generation - returns
			// immediately
			//console.log("full mesh generation " + (+new Date() - time) + "ms");

			return surfid;
		};

		/**
		 * Set the surface material to something else, must render change
		 * 
		 * @param {number} surf - Surface ID to apply changes to
		 * @param {matSpec} style - new material style specification
		 */ 
		this.setSurfaceMaterialStyle = function(surf, style) {
			if (surfaces[surf]) {
				surfaces[surf].mat = getMatWithStyle(style);
				surfaces[surf].mat.side = $3Dmol.FrontSide;
				surfaces[surf].finished = false; // trigger redraw
			}
		};

		/**
		 * Remove surface with given ID
		 * 
		 * @param {number} surf - surface id
		 */
		this.removeSurface = function(surf) {
			if (surfaces[surf] && surfaces[surf].lastGL) {
				if (surfaces[surf].geo !== undefined)
					surfaces[surf].geo.dispose();
				if (surfaces[surf].mat !== undefined)
					surfaces[surf].mat.dispose();
				modelGroup.remove(surfaces[surf].lastGL); // remove from scene
			}
			delete surfaces[surf];
			show();
		};
		
		/** Remove all surfaces.
		 * @function $3Dmol.GLViewer#removeAllSurfaces */
		this.removeAllSurfaces = function() {
			for(var i = 0; i < surfaces.length; i++) {
				if (surfaces[i] && surfaces[i].lastGL) {
					if (surfaces[i].geo !== undefined)
						surfaces[i].geo.dispose();
					if (surfaces[i].mat !== undefined)
						surfaces[i].mat.dispose();
					modelGroup.remove(surfaces[i].lastGL); // remove from scene
				}
				delete surfaces[i];
			}
			show();
		};

		/** return Jmol moveto command to position this scene */
		this.jmolMoveTo = function() {
			var pos = modelGroup.position;
			// center on same position
			var ret = "center { " + (-pos.x) + " " + (-pos.y) + " " + (-pos.z)
					+ " }; ";
			// apply rotation
			var q = rotationGroup.quaternion;
			ret += "moveto .5 quaternion { " + q.x + " " + q.y + " " + q.z
					+ " " + q.w + " };";
			// zoom is tricky.. maybe i would be best to let callee zoom on
			// selection?
			// can either do a bunch of math, or maybe zoom to the center with a
			// fixed
			// but reasonable percentage

			return ret;
		};

		/** Clear scene of all objects 
		 * @function $3Dmol.GLViewer#clear
		 * */
		this.clear = function() {
			this.removeAllSurfaces();
			this.removeAllModels();
			this.removeAllLabels();
			this.removeAllShapes();
			show();
		};

		// props is a list of objects that select certain atoms and enumerate
		// properties for those atoms
		/**
		 * Add specified properties to all atoms matching input argument
		 * @param {Object} props, either array of atom selectors with associated props, or function that takes atom and sets its properties
		 * @param {AtomSelectionSpec} sel
		 */
		this.mapAtomProperties = function(props, sel) {
			sel = sel || {};
			var atoms = getAtomsFromSel(sel);
			
			if(typeof(props) == "function") {
				for (var a = 0, numa = atoms.length; a < numa; a++) {
					var atom = atoms[a];
					props(atom);
				}
			}
			else {
				for (var a = 0, numa = atoms.length; a < numa; a++) {
					var atom = atoms[a];
					for (var i = 0, n = props.length; i < n; i++) {
						var prop = props[i];
						if (prop.props) {
							for ( var p in prop.props) {
								if (prop.props.hasOwnProperty(p)) {
									// check the atom
									if (atomIsSelected(atom, prop)) {
										if (!atom.properties)
											atom.properties = {};
										atom.properties[p] = prop.props[p];
									}
								}
							}
						}
					}
				}
			}
		};

		var getModelGroup = function() {
			return modelGroup;
		};

		try {
			if (typeof (callback) === "function")
				callback(this);
		} catch (e) {
			// errors in callback shouldn't invalidate the viewer
			console.log("error with glviewer callback: " + e);
		}
	}

	return GLViewer;

})();

$3Dmol['glmolViewer'] = $3Dmol.GLViewer;
