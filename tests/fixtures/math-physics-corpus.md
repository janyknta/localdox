# Math & Physics Reader Corpus

A document that exercises every branch of the math pipeline. Open it in the
reader to check rendering, numbering, references, actions, theming and the
fallback path; the unit tests in `tests/math.test.ts` assert the parts that can
be asserted without a browser.

## 1. Basic inline and display

Inline math sits in a line of prose: the fine-structure constant $\alpha \approx 1/137$,
the reduced Planck constant $\hbar$, a subscripted symbol $x_i$, a superscript $e^{i\pi}$.

A price is not math: this costs $5 and that costs $10 — neither delimiter should
open an equation.

An escaped delimiter stays literal: \$x\$ is a dollar sign, an x, a dollar sign.

A display equation stands alone:

$$
e^{i\pi} + 1 = 0
$$

## 2. Fractions and roots

$$
\frac{1}{2} + \cfrac{1}{1 + \cfrac{1}{2 + \cfrac{1}{3}}} = \frac{a}{b}
$$

$$
\sqrt{2}, \quad \sqrt[3]{x + y}, \quad \sqrt{\frac{1 - v^2/c^2}{1 + v^2/c^2}}
$$

$$
\binom{n}{k} = \frac{n!}{k!\,(n-k)!}
$$

## 3. Calculus

Limits, sums, products, integrals and derivatives:

$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
\label{eq:sinc-limit}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}, \qquad
\prod_{p \text{ prime}} \frac{1}{1 - p^{-s}} = \zeta(s)
$$

$$
\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}
\label{eq:gaussian}
$$

$$
\oint_{\partial S} \mathbf{F} \cdot \mathrm{d}\boldsymbol{\ell}
= \iint_S (\nabla \times \mathbf{F}) \cdot \mathrm{d}\mathbf{S}
$$

Derivatives, partial derivatives and a total derivative:

$$
\frac{\mathrm{d}y}{\mathrm{d}x}, \quad
\frac{\partial^2 u}{\partial x\,\partial y}, \quad
\frac{\mathrm{D}\rho}{\mathrm{D}t} = \frac{\partial \rho}{\partial t} + (\mathbf{v}\cdot\nabla)\rho
$$

## 4. Matrices

$$
A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}, \quad
\det A = ad - bc
\label{eq:det}
$$

$$
\begin{bmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \\ 0 & 0 & 1 \end{bmatrix}
\begin{vmatrix} x & y \\ z & w \end{vmatrix}
\begin{Bmatrix} \alpha & \beta \end{Bmatrix}
$$

The Pauli matrices:

$$
\sigma_x = \begin{pmatrix} 0 & 1 \\ 1 & 0 \end{pmatrix}, \quad
\sigma_y = \begin{pmatrix} 0 & -i \\ i & 0 \end{pmatrix}, \quad
\sigma_z = \begin{pmatrix} 1 & 0 \\ 0 & -1 \end{pmatrix}
$$

## 5. Vectors

$$
\mathbf{F} = m\mathbf{a}, \qquad
\vec{p} = m\vec{v}, \qquad
\hat{\mathbf{n}} = \frac{\mathbf{r}}{\lVert \mathbf{r} \rVert}
\label{eq:newton-2}
$$

$$
\mathbf{a} \times \mathbf{b} =
\begin{vmatrix}
\hat{\mathbf{i}} & \hat{\mathbf{j}} & \hat{\mathbf{k}} \\
a_1 & a_2 & a_3 \\
b_1 & b_2 & b_3
\end{vmatrix}
$$

Accents: $\dot{x}$, $\ddot{x}$, $\bar{z}$, $\tilde{f}$, $\hat{H}$, $\vec{r}$,
$\overline{AB}$, $\underline{x}$, $\overrightarrow{PQ}$, $\overbrace{a+b}^{s}$.

## 6. Tensors

$$
T^{\mu\nu}{}_{\rho\sigma}, \qquad
g_{\mu\nu} \mathrm{d}x^{\mu} \mathrm{d}x^{\nu}, \qquad
\Gamma^{\lambda}_{\ \mu\nu} = \tfrac{1}{2} g^{\lambda\rho}
\left( \partial_\mu g_{\rho\nu} + \partial_\nu g_{\rho\mu} - \partial_\rho g_{\mu\nu} \right)
\label{eq:christoffel}
$$

$$
R_{\mu\nu} = R^{\lambda}{}_{\mu\lambda\nu}, \qquad
\epsilon_{ijk}\epsilon_{ilm} = \delta_{jl}\delta_{km} - \delta_{jm}\delta_{kl}
$$

## 7. Greek, blackboard, fraktur and operators

$$
\alpha\beta\gamma\delta\epsilon\varepsilon\zeta\eta\theta\vartheta\iota\kappa
\lambda\mu\nu\xi\pi\varpi\rho\varrho\sigma\varsigma\tau\upsilon\phi\varphi
\chi\psi\omega
$$

$$
\Gamma\Delta\Theta\Lambda\Xi\Pi\Sigma\Upsilon\Phi\Psi\Omega
$$

$$
\mathbb{R}, \mathbb{C}, \mathbb{Z}, \mathbb{N}, \mathbb{Q}, \mathbb{H}
\qquad
\mathfrak{g}, \mathfrak{su}(2), \mathfrak{Re}, \mathfrak{Im}
$$

$$
\mathbf{v}, \boldsymbol{\sigma}, \mathcal{L}, \mathscr{F}, \mathrm{d}, \mathsf{T}, \mathtt{code}
$$

$$
\operatorname{Tr}(\rho), \quad
\operatorname{diag}(\lambda_1, \lambda_2), \quad
\operatorname*{arg\,max}_{x \in X} f(x), \quad
\gcd(a,b), \quad \log, \sin, \cos, \tanh, \exp
$$

Relations and operators: $\leq \geq \neq \equiv \approx \sim \simeq \cong
\propto \ll \gg \subset \subseteq \in \notin \cup \cap \setminus \oplus \otimes
\pm \mp \cdot \times \div \nabla \partial \forall \exists \nexists \therefore$.

Units and symbols, written in plain LaTeX rather than with `siunitx`:
$5\,\mathrm{kg}$, $9.81\,\mathrm{m\,s^{-2}}$, $1.602\times10^{-19}\,\mathrm{C}$,
$300\,\mathrm{K}$, $6.626\times10^{-34}\,\mathrm{J\,s}$,
$25\,^{\circ}\mathrm{C}$, $\Omega$, $\mu\mathrm{m}$, $\mathrm{\mathring{A}}$,
and the reader's own unit macro: $\unit{kg\,m\,s^{-2}}$.

## 8. Maxwell's equations

Differential form, as an aligned block:

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
\label{eq:maxwell}
$$

Covariant form:

$$
\partial_\mu F^{\mu\nu} = \mu_0 J^{\nu}, \qquad
\partial_{[\alpha} F_{\beta\gamma]} = 0
\label{eq:maxwell-covariant}
$$

## 9. Schrödinger equation

Time-dependent and time-independent:

$$
i\hbar \frac{\partial}{\partial t} \Psi(\mathbf{r}, t) =
\left[ -\frac{\hbar^2}{2m}\nabla^2 + V(\mathbf{r}, t) \right] \Psi(\mathbf{r}, t)
\label{eq:schrodinger}
$$

$$
\hat{H}\psi_n = E_n \psi_n
\label{eq:eigen}
$$

The harmonic oscillator's spectrum, $E_n = \hbar\omega\left(n + \tfrac{1}{2}\right)$,
follows from {{eq:eigen}}.

## 10. Dirac notation

$$
\langle \phi | \psi \rangle, \qquad
| \psi \rangle = \sum_n c_n | n \rangle, \qquad
\hat{\rho} = | \psi \rangle\!\langle \psi |
\label{eq:density}
$$

Commutators, anticommutators and expectation values:

$$
[\hat{x}, \hat{p}] = i\hbar, \qquad
\{ \hat{a}, \hat{a}^\dagger \} = 1, \qquad
\langle \hat{A} \rangle = \langle \psi | \hat{A} | \psi \rangle
\label{eq:canonical}
$$

$$
\langle \phi | \hat{H} | \psi \rangle, \qquad
\hat{a}^\dagger | n \rangle = \sqrt{n+1}\,| n+1 \rangle, \qquad
\Delta x \, \Delta p \geq \frac{\hbar}{2}
$$

Using the macro forms the reader also accepts: $\ket{\psi}$, $\bra{\phi}$,
$\braket{\phi}{\psi}$, $\comm{\hat{x}}{\hat{p}}$, $\expval{\hat{H}}$.

## 11. Einstein field equation

$$
G_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}
\label{eq:efe}
$$

$$
R_{\mu\nu} - \tfrac{1}{2} R g_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}
$$

The Schwarzschild metric:

$$
\mathrm{d}s^2 = -\left(1 - \frac{2GM}{rc^2}\right) c^2\mathrm{d}t^2
+ \left(1 - \frac{2GM}{rc^2}\right)^{-1} \mathrm{d}r^2
+ r^2 \mathrm{d}\Omega^2
\label{eq:schwarzschild}
$$

## 12. Lorentz transformations

$$
\begin{pmatrix} ct' \\ x' \\ y' \\ z' \end{pmatrix}
=
\begin{pmatrix}
\gamma & -\beta\gamma & 0 & 0 \\
-\beta\gamma & \gamma & 0 & 0 \\
0 & 0 & 1 & 0 \\
0 & 0 & 0 & 1
\end{pmatrix}
\begin{pmatrix} ct \\ x \\ y \\ z \end{pmatrix}
\label{eq:lorentz}
$$

where $\gamma = \left(1 - \beta^2\right)^{-1/2}$ and $\beta = v/c$.

$$
E^2 = (pc)^2 + (mc^2)^2
\label{eq:energy-momentum}
$$

## 13. Multiline and aligned

`aligned` (KaTeX handles this):

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
        &= a^2 + b^2 + 2ab
\end{aligned}
$$

`cases`:

$$
\operatorname{sgn}(x) =
\begin{cases}
-1 & x < 0 \\
0 & x = 0 \\
1 & x > 0
\end{cases}
\label{eq:sgn}
$$

`gather`:

$$
\begin{gather}
a = b + c \\
d = e + f
\end{gather}
$$

`split`, inside an equation:

$$
\begin{split}
\mathcal{L} &= \tfrac{1}{2}\dot{q}^2 - V(q) \\
            &= T - V
\end{split}
\label{eq:lagrangian}
$$

`align` — an AMS environment KaTeX cannot parse, so this one should arrive via
the MathJax fallback while everything above it stays on the fast engine:

$$
\begin{align}
\nabla \cdot \mathbf{D} &= \rho_f \\
\nabla \times \mathbf{H} &= \mathbf{J}_f + \frac{\partial \mathbf{D}}{\partial t}
\end{align}
$$

`multline` — likewise a MathJax case:

$$
\begin{multline}
\mathcal{L}_{\text{QED}} = \bar{\psi}\left(i\gamma^\mu D_\mu - m\right)\psi \\
- \tfrac{1}{4} F_{\mu\nu}F^{\mu\nu} + \mathcal{L}_{\text{gauge-fixing}}
\end{multline}
$$

## 14. Numbering and references

Numbered, labelled, referenced from prose: Newton's second law is {{eq:newton-2}},
the Einstein field equation is {{eq:efe}}, and the canonical commutator is
{{eq:canonical}}.

Referenced from inside math, which is split out and resolved the same way:
$\eqref{eq:efe}$ implies $\eqref{eq:schwarzschild}$ in the vacuum case, and
$\ref{eq:lorentz}$ gives the bare number.

A reference to a label that does not exist should show as unresolved rather than
break the sentence: {{eq:does-not-exist}}.

Author-suppressed numbering — this one carries no number:

$$
x = y \nonumber
$$

An author-chosen tag rather than the automatic counter:

$$
\Delta S \geq 0 \tag{2nd law}
$$

An equation with no relation in it is not numbered either, because it is a
symbol on display rather than a statement:

$$
\mathcal{H}
$$

## 15. Malformed and unsupported LaTeX

Every case below must render an in-place error and leave the rest of this
document intact.

Unclosed brace:

$$
\frac{1}{2
$$

Unknown command:

$$
\thisCommandDoesNotExist{x}
$$

Mismatched environment:

$$
\begin{pmatrix} a & b \\ c & d \end{bmatrix}
$$

Empty group abuse:

$$
\sqrt[]{}^{}_{}
$$

Inline malformed: $\frac{1}{$ and $\unknownmacro{y}$ mid-sentence.

Something only MathJax can do (a TikZ picture neither engine draws, so this
should be the one case that reaches the error UI after both were tried):

$$
\begin{tikzcd} A \arrow[r] & B \end{tikzcd}
$$

A `trust`-gated command, which must be refused rather than producing a link:

$$
\href{https://example.com}{\text{click}}
$$

## 16. Very long equations (mobile)

These must scroll horizontally inside their own box, at full size, without
widening the page:

$$
\mathcal{L} = -\tfrac{1}{4}F_{\mu\nu}F^{\mu\nu} + i\bar{\psi}\gamma^\mu D_\mu\psi - m\bar{\psi}\psi + |D_\mu\phi|^2 - V(\phi) - \tfrac{1}{4}G^a_{\mu\nu}G^{a\mu\nu} + \tfrac{1}{2}(\partial_\mu h)^2 - \tfrac{1}{2}m_h^2h^2 - \lambda v h^3 - \tfrac{1}{4}\lambda h^4
\label{eq:sm-lagrangian}
$$

$$
\sum_{n=0}^{\infty}\sum_{m=0}^{\infty}\sum_{k=0}^{\infty} \frac{(-1)^{n+m+k}\,x^{2n}\,y^{2m}\,z^{2k}}{(2n)!\,(2m)!\,(2k)!} \cdot \frac{\Gamma(n+m+k+\tfrac{1}{2})}{\Gamma(n+\tfrac{1}{2})\Gamma(m+\tfrac{1}{2})\Gamma(k+\tfrac{1}{2})} \cdot \exp\left(-\frac{n^2+m^2+k^2}{2\sigma^2}\right)
$$

An inline equation that is itself long: $f(x) = a_0 + a_1x + a_2x^2 + a_3x^3 + a_4x^4 + a_5x^5 + a_6x^6 + a_7x^7 + a_8x^8 + a_9x^9$ — the paragraph must reflow around it rather than overflow.

## 17. Light / dark mode

Every symbol here must take its colour from the prose, in both themes — no
symbol should stay black on a dark background or grey out on a light one:
$\int$, $\sum$, $\prod$, $\oint$, $\sqrt{x}$, $\frac{a}{b}$, $\hat{H}$,
$\langle\psi|$, $\mathbb{R}$, $\Omega$, and the display equation:

$$
\oint_{\partial\Sigma} \mathbf{B}\cdot\mathrm{d}\boldsymbol{\ell} = \mu_0 I_{\text{enc}}
$$

## 18. Repeated equations (cache)

The same expression, five times: $e^{i\pi} + 1 = 0$, $e^{i\pi} + 1 = 0$,
$e^{i\pi} + 1 = 0$, $e^{i\pi} + 1 = 0$, $e^{i\pi} + 1 = 0$. All five should be
one render and four cache hits.

And the display form, twice — identical source, so the second is a cache hit but
still gets its own equation number:

$$
\nabla^2 \phi = 4\pi G \rho
$$

$$
\nabla^2 \phi = 4\pi G \rho
$$

## 19. Interaction with other markdown features

Math inside a table cell:

| Quantity | Symbol | Value |
| --- | --- | --- |
| Planck constant | $h$ | $6.626\times10^{-34}\,\mathrm{J\,s}$ |
| Speed of light | $c$ | $2.998\times10^{8}\,\mathrm{m\,s^{-1}}$ |
| Fine structure | $\alpha$ | $1/137.036$ |

Math in a list:

1. The action is $S = \int L\,\mathrm{d}t$.
2. Varying it gives $\delta S = 0$.
3. Which yields $\frac{\mathrm{d}}{\mathrm{d}t}\frac{\partial L}{\partial \dot{q}} - \frac{\partial L}{\partial q} = 0$.

Math in a blockquote:

> [!NOTE]
> The Euler–Lagrange equation above, $\frac{\mathrm{d}}{\mathrm{d}t}\frac{\partial L}{\partial\dot{q}} = \frac{\partial L}{\partial q}$, is the whole of classical mechanics.

Math in a heading:

### The value of $\pi$

Math must **not** be typeset inside a code fence — this block should show its
source verbatim:

```latex
$$
E = mc^2
$$
```

Nor in an inline code span: `$E = mc^2$`.

A Mermaid diagram beside math, to confirm neither breaks the other:

```mermaid
graph LR
  A[State] --> B[Measurement]
  B --> C[Collapse]
```

$$
P(\text{outcome } i) = |\langle i | \psi \rangle|^2
$$
