/* core Object3D
 * Base class for Scene, Camera, Geometry
 * Geometry class
 */

var WebMol = WebMol || {};

//Event Handling
WebMol.EventDispatcher = function() {
  
    var listeners = {};
    
    this.addEventListener = function(type, listener) {
        if (listeners[type] === undefined)
            listeners[type] = [];
        
        if (listeners[type].indexOf(listener) === -1)
            listeners[type].push(listener);
    };  
    
    this.removeEventListener = function(type, listener) {
        
        var index = listeners[type].indexOf(listener);
        
        if (index !== -1)
            listeners[type].splice(index, 1);
              
    };
    
    this.dispatchEvent = function(event) {
        
        var listenerArray = listeners[event.type];
        
        if (listenerArray !== undefined) {
            event.target = this;
            
            for (var i = 0, l = listenerArray.length; i < l; i++)
                listenerArray[i].call(this, event);
                
        }
            
    };
    
};


//Object3D base constructor function
WebMol.Object3D = function() {
    
    this.id = WebMol.Object3DIDCount++;
    
    this.name = "";
    
    this.parent = undefined;
    this.children = [];
    
    //TODO: Replace this with own class
    this.position = new WebMol.Vector3();
    this.rotation = new WebMol.Vector3();
    this.matrix = new WebMol.Matrix4();
    this.matrixWorld = new WebMol.Matrix4();
    this.quaternion = new WebMol.Quaternion();
    this.eulerOrder = 'XYZ';
    
    this.up = new WebMol.Vector3(0, 1, 0);
    this.scale = new WebMol.Vector3(1, 1, 1);
    
    this.matrixAutoUpdate = true;
    this.matrixWorldNeedsUpdate = true;
    this.rotationAutoUpdate = true;
    this.useQuaternion = false;
    
    this.visible = true;
    
};

WebMol.Object3D.prototype = {
    
    constructor : WebMol.Object3D,
    
    lookAt : function(vector) {
        
        this.matrix.lookAt(vector, this.position, this.up);
        
        if (this.rotationAutoUpdate) {
            
            if (this.useQuaternion === true) 
                this.quaternion.copy(this.matrix.decompose()[1]);
            else
                this.rotation.setEulerFromRotationMatrix(this.matrix, this.eulerOrder);
        }
    },
    
    //add child object
    add : function(object) {
        if (object === this){
            console.error("Can't add WebMol.Object3D to itself");
            return;
        }
        
        object.parent = this;
        this.children.push(object);
        
        //add to the scene (i.e. follow up this instance's parents until reach the top)
        
        var scene = this;
        
        while (scene.parent !== undefined)
            scene = scene.parent;
            
        if (scene !== undefined && scene instanceof WebMol.Scene) 
            scene.__addObject(object);
        
    },
    
    remove : function(object) {
        
        var index = this.children.indexOf(object);
        
        if (index !== -1) {
            
            object.parent = undefined;
            this.children.splice(index, 1);
            
            //Remove from scene
            
            var scene = this;
            
            while (scene.parent !== undefined)
                scene = scene.parent;
                
            if (scene !== undefined && scene instanceof WebMol.Scene)
                scene.__removeObject(object);
                
        }
    },
    
    updateMatrix : function() {
        
        this.matrix.setPosition(this.position);
        
        if (this.useQuaternion === false) 
            this.matrix.setRotationFromEuler(this.rotation, this.eulerOrder);
        else
            this.matrix.setRotationFromQuaternion(this.quaternion);
        
        //TODO: Do I need this??
        if (this.scale.x !== 1 || this.scale.y !== 1 || this.scale.z !== 1)
            this.matrix.scale(this.scale);
            
        this.matrixWorldNeedsUpdate = true;
        
    },
    
    updateMatrixWorld : function(force) {
        
        if (this.matrixAutoUpdate === true) 
            this.updateMatrix();
        
        if (this.matrixWorldNeedsUpdate === true || force === true) {
            
            if (this.parent === undefined)
                this.matrixWorld.copy(this.matrix);
            else
                this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
                
        }
        
        this.matrixWorldNeedsUpdate = false;
        
        //Update matrices of all children
        for (var i in this.children) {
            this.children[i].updateMatrixWorld(true);
        }
    },
    
    clone : function(object) {
        
        if (object === undefined)
            object = new WebMol.Object3D();
            
        object.name = this.name;
        
        object.up.copy(this.up);
        object.position.copy(this.position);
        object.rotation.copy(this.rotation);
        object.eulerOrder = this.eulerOrder;
        object.scale.copy(this.scale);
        
        object.rotationAutoUpdate = this.rotationAutoUpdate;
        object.matrix.copy(this.matrix);
        object.matrixWorld.copy(this.matrixWorld);
        object.quaternion.copy(this.quaternion);
        
        object.useQuaternion = this.useQuaternion;
        
        object.visible = this.visible;
        
        for (var i in this.children) {
            var child = this.children[i];
            object.add(child.clone());
        }
        
        return object;
        
    }
    
};

WebMol.Object3DIDCount = 0;

//Geometry class
//TODO: What can I remove - how can I optimize ?

WebMol.Geometry = function() {
    
    WebMol.EventDispatcher.call(this);
    
    this.id = WebMol.GeometryIDCount++;

    this.name = '';
    
    this.vertices = 0;
    this.interesetShapes = []; // list of spheres and/or boxes of clickable atoms in this geometry

    this.hasTangents = false;

    this.dynamic = true; // the intermediate typed arrays will be deleted when set to false

    // update flags

    this.verticesNeedUpdate = false;
    this.elementsNeedUpdate = false;
    this.normalsNeedUpdate = false;
    this.colorsNeedUpdate = false;

    this.buffersNeedUpdate = false;
    
};


WebMol.Geometry.prototype = {
  
    constructor : WebMol.Geometry,
  
    dispose : function() {
    
        this.dispatchEvent( {type: 'dispose'} );
        
    }
    
};

WebMol.GeometryIDCount = 0;


//Raycaster

WebMol.Raycaster = (function() {
    
    function Raycaster(origin, direction, far, near) {
        
        this.ray = new WebMol.Ray(origin, direction);
        
        if (this.ray.direction.lengthSq() > 0) 
            this.ray.direction.normalize();
        
        this.near = near || 0;
        this.far = far || Infinity;
    
    };
    
    var sphere = new WebMol.Sphere();
    var cylinder = new WebMol.Cylinder();
    var w_0 = new WebMol.Vector3(); // for cylinders, cylinder.c1 - ray.origin
    var v1 = new WebMol.Vector3(); // all purpose local vector
    var v2 = new WebMol.Vector3();
    var v3 = new WebMol.Vector3();
    //var facePlane = new WebMol.Plane();
    var localRay = new WebMol.Ray();
    var intersectPoint = new WebMol.Vector3();
    var matrixPosition = new WebMol.Vector3();
    
    var inverseMatrix = new WebMol.Matrix4();
        
    var descSort = function(a, b) {
        return a.distance - b.distance;
    };

    // [-1, 1]
    var clamp = function(x) {
        return Math.min(Math.max(x, -1), 1);
    };
    
    //object is a Sphere or (Bounding) Box
    var intersectObject = function(group, atom, raycaster, intersects) {
        
        matrixPosition.getPositionFromMatrix(group.matrixWorld);
        
        if ((atom.clickable !== true) || (atom.intersectionShape === undefined))
            return intersects;
        var sulfur;
        if (atom.elem === "S")
            sulfur = true;
        
        var intersectionShape = atom.intersectionShape;
        var precision = raycaster.linePrecision;
        precision *= group.matrixWorld.getMaxScaleOnAxis();
        var precisionSq = precision*precision;
        
        //cylinders
        for (var i in intersectionShape.cylinder) {
            
            if (intersectionShape.cylinder[i] instanceof WebMol.Cylinder){
                
                cylinder.copy(intersectionShape.cylinder[i]);
                cylinder.applyMatrix4(group.matrixWorld);
                
                w_0.subVectors(cylinder.c1, raycaster.ray.origin); 
                
                var cylProj = w_0.dot(cylinder.direction); // Dela
                var rayProj = w_0.dot(raycaster.ray.direction); // Epsilon
                
                var normProj = clamp(raycaster.ray.direction.dot(cylinder.direction)); // Beta
                
                var denom = 1 - normProj*normProj;
                
                if (denom === 0.0)
                    continue;
                
                var s_c = (normProj*rayProj - cylProj) / denom;
                var t_c = (rayProj - normProj*cylProj) / denom;
                
                v1.copy(cylinder.direction).multiplyScalar(s_c).add(cylinder.c1);  // Q_c
                v2.copy(raycaster.ray.direction).multiplyScalar(t_c).add(raycaster.ray.origin); // P_c
                
                var closestDistSq = v3.subVectors(v1, v2).lengthSq();
                // closest distance between ray and cylinder axis not greater than cylinder radius;
                // might intersect this cylinder between atom and bond midpoint
                if (closestDistSq <= cylinder.radius*cylinder.radius){
                    var distance;
                    
                    //Find points where ray intersects sides of cylinder
                    var discriminant = (normProj*cylProj - rayProj)*(normProj*cylProj - rayProj) - 
                            denom*(w_0.lengthSq() - cylProj*cylProj - cylinder.radius*cylinder.radius);
                    
                    // ray tangent to cylinder?
                    if (discriminant <= 0)
                        distance = Math.sqrt(closestSqDist);
                    
                    //find closest intersection point; make sure it's between atom's position and cylinder midpoint
                    else {
                        var t = distance = ( (rayProj - normProj*cylProj) - Math.sqrt(discriminant) ) / denom;                   
                        var s = normProj*t - cylProj;
                        
                        //does not intersect cylinder between atom and midpoint,
                        // or intersects cylinder behind camera
                        if (s < 0 || s*s > cylinder.lengthSq() || t < 0)
                            continue
                        
                        else
                            intersects.push({atom : atom,
                                             distance : distance});
                    }
                }
                    
                
            }
            
        }
         
        //lines
        for (var i = 0, il = intersectionShape.line.length; i < il; i += 2) {
            
            v1.copy(intersectionShape.line[i]);
            v1.applyMatrix4(group.matrixWorld);
            v2.copy(intersectionShape.line[i+1]);
            v2.applyMatrix4(group.matrixWorld);
            
            v3.subVectors(v2, v1);
            var bondLengthSq = v3.lengthSq();
            v3.normalize();
            
            w_0.subVectors(v1, raycaster.ray.origin);
            
            var lineProj = w_0.dot(v3);
            var rayProj = w_0.dot(raycaster.ray.direction);
            
            var normProj = clamp(raycaster.ray.direction.dot(v3));
            
            var denom = 1 - normProj*normProj;
            
            if (denom === 0.0)
                continue;
            
            var s_c = (normProj*rayProj - lineProj) / denom;
            var t_c = (rayProj - normProj*lineProj) / denom;
            
            v1.add(v3.multiplyScalar(s_c)); // Q_c
            v2.copy(raycaster.ray.direction).multiplyScalar(t_c).add(raycaster.ray.origin); // P_c
            
            var closestDistSq = v3.subVectors(v2, v1).lengthSq();
            
            if (closestDistSq < precisionSq && s_c*s_c < bondLengthSq)
                intersects.push({atom : atom,
                                 distance : t_c
                                });
            
        }
        
        //sphere
        if (intersectionShape.sphere instanceof WebMol.Sphere) {
            
            sphere.copy(intersectionShape.sphere);
            sphere.applyMatrix4(group.matrixWorld);
            
            //TODO: for descSort to work, must push intersection object in 
            // intersects that includes distance 
            if (raycaster.ray.isIntersectionSphere(sphere)) {
                
                var distance;
                
                v1.subVectors(sphere.center, raycaster.ray.origin);
                
                //distance from ray origin to point on the ray normal to sphere's center
                //must be less than sphere's radius (since ray intersects sphere)
                var distanceToCenter = v1.dot(raycaster.ray.direction);
                
                var discriminant = distanceToCenter*distanceToCenter - (v1.lengthSq() - sphere.radius*sphere.radius);
                
                //Don't select if sphere center behind camera
                if (distanceToCenter < 0) 
                    return intersects;
                
                //ray tangent to sphere?
                if (discriminant <= 0)
                    distance = distanceToCenter;
                
                //This is reversed if sphere is closer than ray origin.  Do we have 
                //to worry about handling that case?
                else 
                    distance = distanceToCenter - Math.sqrt(discriminant);
                
                //distance = - sphere.center.z;
                intersects.push({atom : atom, 
                                 distance : distance});
                return intersects;
            }
        }        
       
        
    };   
       
    Raycaster.prototype.precision = 0.0001;
    Raycaster.prototype.linePrecision = 0.2;
    
    Raycaster.prototype.set = function(origin, direction) {
        
        this.ray.set(origin, direction);
          
    };
    
    Raycaster.prototype.intersectObjects = function(group, objects) {
        
        var intersects = [];
        
        for (var i = 0, l = objects.length; i < l; i++)            
            intersectObject(group, objects[i], this, intersects);
            
        intersects.sort(descSort);
        
        return intersects;
        
    };
    
    return Raycaster;
    
})();


//WebMol Projecion 
//TODO: can probably strip this down a lot (only used for selection handling)
WebMol.Projector = function () {

    var _viewMatrix = new WebMol.Matrix4(),
    _viewProjectionMatrix = new WebMol.Matrix4();

    this.projectVector = function ( vector, camera ) {

            camera.matrixWorldInverse.getInverse( camera.matrixWorld );

            _viewProjectionMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );

            return vector.applyProjection( _viewProjectionMatrix );

    };

    this.unprojectVector = function ( vector, camera ) {

            camera.projectionMatrixInverse.getInverse(camera.projectionMatrix);

            _viewProjectionMatrix.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);

            return vector.applyProjection( _viewProjectionMatrix );

    };

};