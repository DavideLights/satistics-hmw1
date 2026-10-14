# Implementation Plan - secp256k1 Point Multiplication & Coordinate Distribution

Here is the implementation plan, followed by the required statistical and cryptographic analysis text to include directly in the HTML.

---

### 1. Architecture & File Structure

Keep the project flat and dependency-free. No bundlers, no external libraries.

* `index.html`: Semantic layout containing inputs, visual step log, canvas plot, and the analysis paragraph.
* `style.css`: High-contrast, clean UI. Monospace fonts for numbers/hex, sans-serif for text.
* `script.js`: Procedural JavaScript using native `BigInt` for 256-bit arithmetic.

---

### 2. UI & Layout Plan (`index.html` & `style.css`)

**Design Constraints:**

* **Palette:** Background `#FFFFFF`, Text `#111111`, Borders `#CCCCCC`, Accent/Highlight `#0055FF`, Muted text `#555555`. No gradients, shadows, or icons.
* **Typography:** `system-ui, sans-serif` for UI and text; `monospace` for coordinates, binary representations, and logs.
* **Layout:** Single-column container (`max-width: 900px`, centered) divided into 4 clean bordered sections:

1. **Header & Parameters Panel:**
   * Displays static `secp256k1` parameters ($p$, $a=0$, $b=7$, and Generator $G_x, G_y$ in hex).

2. **Controls Panel:**
   * `<input type="number">` for private key $k$ (note in UI: keep $k$ small, e.g., $k \le 1000$, when testing the Naive method).
   * `<select>` or radio buttons for Method: **Naive ($G + G + \dots$)** vs **Double-and-Add**.
   * `<input type="range">` for step delay ($50\text{ms}$ to $1000\text{ms}$).
   * `<button>` Run / Reset.

3. **Visual Execution & Plot Panel (2-Column Grid):**
   * **Left Column (Algorithm Trace):** Shows the binary expansion of $k$, current step counter, current operation (`ADD` or `DOUBLE`), and live resulting coordinates $(Q_x, Q_y)$.
   * **Right Column (2D Coordinate Scatter Canvas):** A `<canvas>` (e.g., `400x400px`) plotting the normalized coordinates $(x/p, y/p) \in [0,1]^2$ for every intermediate point visited during computation.

4. **Statistical & Cryptographic Analysis Section:**
   * Static text block containing the required theoretical paragraph.

---

### 3. JavaScript Implementation Plan (`script.js`)

Use procedural functions and native `BigInt` (`0n`, `1n`, etc.). Do not create classes or complex state machines.

#### A. Constants (`secp256k1`)

* `P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn`
* `Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n`
* `Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n`

#### B. Core Math Functions (Affine Coordinates)

Represent points as simple objects `{ x: BigInt, y: BigInt }` or `null` for the point at infinity.

1. `mod(n, m)`: Returns `((n % m) + m) % m` to handle negative results in JS `%`.
2. `modInverse(a, m)`: Standard Extended Euclidean Algorithm using a `while` loop to find $a^{-1} \pmod P$.
3. `pointAdd(P1, P2)`:
   * Handle `null` cases.
   * If $P_1.x === P_2.x$ and $P_1.y \neq P_2.y$, return `null`.
   * If $P_1.x === P_2.x$ and $P_1.y === P_2.y$, call `pointDouble(P1)`.
   * Compute slope $\lambda = (P_2.y - P_1.y) \cdot (P_2.x - P_1.x)^{-1} \pmod P$.
   * Compute $x_3 = (\lambda^2 - P_1.x - P_2.x) \pmod P$ and $y_3 = (\lambda(P_1.x - x_3) - P_1.y) \pmod P$.
4. `pointDouble(P1)`:
   * Compute slope $\lambda = (3 \cdot P_1.x^2) \cdot (2 \cdot P_1.y)^{-1} \pmod P$ (since $a = 0$).
   * Compute $x_3, y_3$ same as above.

#### C. Scalar Multiplication & Slow-Down Visualization

Use an `async` function paused with `const sleep = (ms) => new Promise(r => setTimeout(r, ms));`.

1. **Method 1: Linear/Naive (`computeNaive(k, delay)`)**
   * Initialize `Q = G`.
   * Loop `i` from `2n` to `k`:
     * `Q = pointAdd(Q, G)`
     * Call `updateUI(step, "Q = Q + G", Q)`
     * `await sleep(delay)`

2. **Method 2: Double-and-Add (`computeDoubleAndAdd(k, delay)`)**
   * Convert `k` to binary string: `const bits = k.toString(2)`.
   * Initialize `Q = G`.
   * Loop through `bits` from index `1` to `bits.length - 1`:
     * `Q = pointDouble(Q)`
     * Call `updateUI(step, "DOUBLE", Q)`
     * `await sleep(delay)`
     * If `bits[i] === '1'`:
       * `Q = pointAdd(Q, G)`
       * Call `updateUI(step, "ADD G", Q)`
       * `await sleep(delay)`

#### D. Canvas Plotting (`updateUI`)

* Normalize 256-bit coordinates to canvas pixels (`400x400`) by shifting off the lower 240 bits:
  * `px = Number(Q.x >> 240n) / 65535 * canvasWidth`
  * `py = Number(Q.y >> 240n) / 65535 * canvasHeight`
* Draw a `3x3` black square for past points, and a `5x5` blue (`#0055FF`) square for the current point.

---

### 4. Website Paragraph: Statistical & Cryptographic Properties

*Copy this text directly into the `<section id="analysis">` of your HTML:*

> **Statistical and Cryptographic Properties of $Q = kG$ on secp256k1**
> In the finite field $\mathbb{F}_p$ of `secp256k1`, the $x$ and $y$ coordinates of generated points $Q = kG$ exhibit an **apparent uniformity** across the interval $[0, p-1]$. Because the generator $G$ creates a prime-order cyclic subgroup of size $n \approx p$, the **distribution of $x$ and $y$ coordinates** over the full cycle is nearly flat. Specifically, regarding the **frequency of individual values**, any valid $x$ coordinate appears at most twice (corresponding to $+y$ and $-y \bmod p$), and roughly half of the elements in $\mathbb{F}_p$ are valid $x$ coordinates (when $x^3 + 7$ is a quadratic residue modulo $p$). Consequently, the **distribution of bits** within $Q_x$ and $Q_y$ approaches a Bernoulli($0.5$) process, showing balanced 0s and 1s without local clustering. Furthermore, incrementing the scalar $k \to k+1$ causes a nonlinear modular inversion during point addition, destroying linear **correlations between input and output** and producing a strong **avalanche-like behaviour** where flipping a single bit in $k$ flips approximately 50% of the bits in $Q$.
> However, it is critical to distinguish between properties required for a **cryptographic one-way function** (like Elliptic Curve scalar multiplication) and those strictly required for **cryptographic hash functions**. For $Q = kG$ to act as a secure one-way trapdoor, the essential property is algebraic: the computational intractability of the Elliptic Curve Discrete Logarithm Problem (ECDLP) and the absence of exploitable input-output correlations that would allow recovering $k$ from $Q$ faster than $\mathcal{O}(\sqrt{n})$. Conversely, bit-level uniformity, strict avalanche criteria, and flat value frequencies are core design metrics of **cryptographic hash functions** (e.g., SHA-256) to guarantee preimage and collision resistance on unstructured bitstrings. In ECC, apparent uniformity and avalanche effects are statistical byproducts of modular inversion over a large prime field, not the source of security itself—which is why raw EC coordinates should still be passed through a Key Derivation Function (KDF) or hash function before being used as symmetric keys.
