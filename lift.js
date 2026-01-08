// --- Constants ---
const TIME_PER_FLOOR_MS = 2000; 
const TIME_OPEN_DOOR_MS = 2500;
const TIME_CLOSE_DOOR_MS = 2500;
const TIME_WAIT_MS = 1000; 

// Visual configuration
let FLOOR_HEIGHT = 100;

// --- State ---
let lifts = [];
let floorCount = 0;

// --- Helper ---
function formatFloor(f) {
  return f === 0 ? 'G' : f.toString();
}

function isButtonActive(floor, dir) {
    const btn = document.getElementById(`btn-${dir}-${floor}`);
    return btn ? btn.classList.contains('active') : false;
}

// --- Classes ---

class Lift {
  constructor(id) {
    this.id = id;
    this.currentFloor = 0; 
    this.stops = new Set();
    this.isBusy = false;
    this.element = null;
    this.statusElement = null;
    this.direction = null; // 'UP' | 'DOWN' | null
    this.nextStop = null;
  }

  setElement(el) {
    this.element = el;
    this.statusElement = el.querySelector('.lift-status-box');
    this.updateVisualPosition(0);
  }

  addStop(floor) {
    this.stops.add(floor);
    this.process();
  }

  updateVisualPosition(durationMs) {
    if (this.element) {
      this.element.style.transition = `bottom ${durationMs}ms linear`;
      // +5 aligns with CSS bottom: 5px
      this.element.style.bottom = `${(this.currentFloor * FLOOR_HEIGHT) + 5}px`;
    }
  }

  updateStatusDisplay(htmlContent) {
    if (this.statusElement) {
        this.statusElement.innerHTML = htmlContent;
    }
  }

  // Decides if the lift should actually stop at the current floor
  // based on its direction and the active buttons.
  checkShouldStop() {
    // If not in stops, obviously don't stop.
    if (!this.stops.has(this.currentFloor)) return false;

    // If we are IDLE or have no direction yet, we stop.
    if (this.direction === null) return true;

    // Directional Logic
    if (this.direction === 'UP') {
        const upActive = isButtonActive(this.currentFloor, 'UP');
        // Always stop for a request in our direction
        if (upActive) return true;
        
        // Check for reversal
        const hasHigherStops = Array.from(this.stops).some(f => f > this.currentFloor);
        if (hasHigherStops) {
            // We have higher stops, so we are continuing UP.
            // If there is NO up request, we skip this floor (assuming the stop was added for a DOWN request).
            return false;
        }
        
        // No higher stops -> Reversal -> Stop here.
        return true;
    }

    if (this.direction === 'DOWN') {
        const downActive = isButtonActive(this.currentFloor, 'DOWN');
        if (downActive) return true;

        const hasLowerStops = Array.from(this.stops).some(f => f < this.currentFloor);
        if (hasLowerStops) {
            return false; 
        }
        
        return true;
    }

    return true;
  }

  async process() {
    if (this.isBusy) return;

    // 1. Check if we are at a stop AND should stop
    if (this.checkShouldStop()) {
      await this.handleDoorSequence();
      this.process(); // Re-evaluate logic after sequence
      return;
    }

    // 2. Determine Next Target
    if (this.stops.size === 0) {
      this.direction = null;
      this.nextStop = null;
      if (this.element) {
        this.element.classList.remove('moving');
      }
      this.updateStatusDisplay('<span>--</span>');
      return;
    }

    let targetFloor = null;
    const requestedFloors = Array.from(this.stops).sort((a, b) => a - b);

    // Maintain momentum logic
    if (this.direction === 'UP') {
      const above = requestedFloors.find(f => f > this.currentFloor);
      if (above !== undefined) {
        targetFloor = above;
      } else {
        // Reversal
        this.direction = 'DOWN';
        const below = requestedFloors.filter(f => f < this.currentFloor);
        if (below.length > 0) targetFloor = below[below.length - 1];
      }
    } else if (this.direction === 'DOWN') {
       const below = requestedFloors.filter(f => f < this.currentFloor).sort((a,b) => b-a);
       if (below.length > 0) {
         targetFloor = below[0];
       } else {
         // Reversal
         this.direction = 'UP';
         const above = requestedFloors.filter(f => f > this.currentFloor);
         if (above.length > 0) targetFloor = above[0];
       }
    } else {
      // IDLE -> Pick nearest
      const sortedByDist = requestedFloors.sort((a, b) => Math.abs(a - this.currentFloor) - Math.abs(b - this.currentFloor));
      targetFloor = sortedByDist[0];
      this.direction = targetFloor > this.currentFloor ? 'UP' : 'DOWN';
    }

    if (targetFloor !== null && targetFloor !== undefined && targetFloor !== this.currentFloor) {
      this.nextStop = targetFloor;
      await this.moveOneStep();
    } else if (targetFloor === this.currentFloor) {
        // Failsafe: If logic brought us here but checkShouldStop failed earlier?
        // It might happen if we are assigned a job while idle at the floor.
        await this.handleDoorSequence();
        this.process();
    }
  }

  async moveOneStep() {
    this.isBusy = true;
    if (this.element) {
      this.element.classList.add('moving');
      
      const arrow = this.direction === 'UP' ? '▲' : '▼';
      const nextStopDisplay = this.nextStop !== null ? formatFloor(this.nextStop) : '--';
      this.updateStatusDisplay(`
        <span style="font-size: 1.1em; margin-right: 4px;">${arrow}</span>
        <span style="font-size: 1.1em;">${nextStopDisplay}</span>
      `);
    }

    // Physical Move
    if (this.direction === 'UP') this.currentFloor++;
    else if (this.direction === 'DOWN') this.currentFloor--;

    this.updateVisualPosition(TIME_PER_FLOOR_MS);
    await new Promise(r => setTimeout(r, TIME_PER_FLOOR_MS));
    
    this.isBusy = false;
    this.process();
  }

  async handleDoorSequence() {
    this.isBusy = true;
    
    const floor = this.currentFloor;
    const currentDir = this.direction;

    const upActive = isButtonActive(floor, 'UP');
    const downActive = isButtonActive(floor, 'DOWN');

    let servicedUp = false;
    let servicedDown = false;

    // Logic: Decide which request(s) we are servicing.
    // AND Check for Reversal to prevent double-opening.
    
    if (currentDir === 'UP') {
        if (upActive) servicedUp = true;
        
        // CHECK REVERSAL: If no higher stops, we can also service DOWN.
        const hasHigherStops = Array.from(this.stops).some(f => f > floor);
        if (!hasHigherStops) {
            if (downActive) servicedDown = true;
        }
    } else if (currentDir === 'DOWN') {
        if (downActive) servicedDown = true;
        
        // CHECK REVERSAL: If no lower stops, we can also service UP.
        const hasLowerStops = Array.from(this.stops).some(f => f < floor);
        if (!hasLowerStops) {
            if (upActive) servicedUp = true;
        }
    } else {
        // IDLE
        if (upActive) servicedUp = true;
        if (downActive) servicedDown = true;
    }

    // Clear buttons
    if (servicedUp) updateButtonState(floor, 'UP', false);
    if (servicedDown) updateButtonState(floor, 'DOWN', false);

    // Remove stop for this floor
    this.stops.delete(this.currentFloor);

    // If we did NOT service a button that is active, we must ensure it gets handled.
    if (upActive && !servicedUp) assignLift(floor, 'UP');
    if (downActive && !servicedDown) assignLift(floor, 'DOWN');

    // Animation
    if (this.element) {
      this.element.classList.remove('moving');
      this.element.classList.add('doors-open'); 
      this.updateStatusDisplay(`<span style="font-size: 1.2em;">${formatFloor(this.currentFloor)}</span>`);
    }

    await new Promise(r => setTimeout(r, TIME_OPEN_DOOR_MS));
    await new Promise(r => setTimeout(r, TIME_WAIT_MS));
    
    if (this.element) {
      this.element.classList.remove('doors-open');
    }
    
    await new Promise(r => setTimeout(r, TIME_CLOSE_DOOR_MS));

    this.isBusy = false;
  }
}

// --- DOM & Helpers ---
const numFloorsInput = document.getElementById('numFloors');
const numLiftsInput = document.getElementById('numLifts');
const generateBtn = document.getElementById('generateBtn');
const errorMessage = document.getElementById('error-message');
const simRoot = document.getElementById('simulation-root');
const simContainer = document.getElementById('simulation-container');

// Helper to update global FLOOR_HEIGHT based on screen size
function updateFloorHeight() {
  if (window.innerWidth < 600) FLOOR_HEIGHT = 80;
  else FLOOR_HEIGHT = 100;
  
  // Update existing lifts if any
  lifts.forEach(lift => lift.updateVisualPosition(0));
}

window.addEventListener('resize', updateFloorHeight);

generateBtn.addEventListener('click', () => {
  const f = parseInt(numFloorsInput.value);
  const l = parseInt(numLiftsInput.value);

  // Validation Logic
  let errorText = "";
  if (isNaN(f) || f < 2) {
    errorText = "Number of floors must be greater than 1.";
  } else if (isNaN(l) || l < 1) {
    errorText = "Number of lifts must be greater than 0.";
  }

  if (errorText) {
    errorMessage.textContent = errorText;
    errorMessage.classList.remove('hidden');
    return;
  }

  errorMessage.classList.add('hidden');
  initSimulation(f, l);
});

function updateButtonState(floor, dir, isActive) {
    const btn = document.getElementById(`btn-${dir}-${floor}`);
    if (btn) {
        if (isActive) btn.classList.add('active');
        else btn.classList.remove('active');
    }
}

function initSimulation(floors, liftCount) {
  simContainer.innerHTML = '';
  lifts = [];
  floorCount = floors;
  simRoot.classList.remove('hidden');
  
  updateFloorHeight(); // Set initial height

  // 1. Floors Column
  const floorsCol = document.createElement('div');
  floorsCol.className = 'floors-column';
  
  for (let i = 0; i < floors; i++) {
    const floorDiv = document.createElement('div');
    floorDiv.className = 'floor';
    
    let buttonsHtml = '';
    const upBtn = `<button id="btn-UP-${i}" class="direction-btn" onclick="window.callLift(${i}, 'UP')">▲</button>`;
    const downBtn = `<button id="btn-DOWN-${i}" class="direction-btn" onclick="window.callLift(${i}, 'DOWN')">▼</button>`;

    if (i === 0) {
        buttonsHtml = upBtn;
    } else if (i === floors - 1) {
        buttonsHtml = downBtn;
    } else {
        buttonsHtml = upBtn + downBtn;
    }

    floorDiv.innerHTML = `
      <span class="floor-label">${formatFloor(i)}</span>
      <div class="controls">
        ${buttonsHtml}
      </div>
    `;
    floorsCol.appendChild(floorDiv);
  }
  simContainer.appendChild(floorsCol);

  // 2. Shafts
  const shaftsContainer = document.createElement('div');
  shaftsContainer.className = 'shafts-container';
  shaftsContainer.style.height = `${floors * FLOOR_HEIGHT}px`;

  for (let i = 0; i < liftCount; i++) {
    const shaft = document.createElement('div');
    shaft.className = 'shaft';
    
    const liftEl = document.createElement('div');
    liftEl.className = 'lift';
    liftEl.id = `lift-${i}`;
    
    liftEl.innerHTML = `
        <div class="lift-status-box"><span>--</span></div>
        <div class="door left"></div>
        <div class="door right"></div>
    `;
    
    shaft.appendChild(liftEl);
    shaftsContainer.appendChild(shaft);

    const liftObj = new Lift(i);
    liftObj.setElement(liftEl);
    lifts.push(liftObj);
  }

  simContainer.appendChild(shaftsContainer);
}

// Global scope
window.callLift = (floorIndex, direction) => {
  const btn = document.getElementById(`btn-${direction}-${floorIndex}`);
  if (btn && btn.classList.contains('active')) return; 

  updateButtonState(floorIndex, direction, true);
  assignLift(floorIndex, direction);
};

function assignLift(floor, direction) {
  let bestLift = null;
  let minCost = Infinity;

  for (const lift of lifts) {
    let cost = Infinity;
    const dist = Math.abs(lift.currentFloor - floor);

    if (lift.direction === null) {
      // IDLE
      cost = dist;
    } else if (lift.direction === direction) {
      // SAME DIRECTION
      if (direction === 'UP') {
         if (lift.currentFloor <= floor) {
             cost = dist;
         } else {
             cost = dist + (floorCount * 2); // Penalty for passed
         }
      } else { // DOWN
         if (lift.currentFloor >= floor) {
             cost = dist;
         } else {
             cost = dist + (floorCount * 2);
         }
      }
    } else {
      // OPPOSITE DIRECTION
      cost = dist + floorCount; 
    }

    // Minor load balancing
    if (cost < Infinity) {
        cost += (lift.stops.size * 0.5);
    }

    if (cost < minCost) {
      minCost = cost;
      bestLift = lift;
    }
  }

  if (!bestLift) {
     // Fallback: nearest regardless of direction
     bestLift = lifts.sort((a,b) => Math.abs(a.currentFloor - floor) - Math.abs(b.currentFloor - floor))[0];
  }

  if (bestLift) {
    bestLift.addStop(floor);
  }
}
