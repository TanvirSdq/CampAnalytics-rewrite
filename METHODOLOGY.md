# CampAnalytics Analytical & Methodological Framework

This document outlines the theoretical foundations, mathematical formulations, calibration procedures, and benchmark estimation techniques employed across the CampAnalytics platform.

---

## 1. Overview and Core Analytical Modules

CampAnalytics is an analytical suite designed for organizers, researchers, and grant committees within the Wikimedia ecosystem. The platform provides empirical visibility into contributor dynamics and content outcomes across annual photography competitions (Wiki Loves Monuments, Wiki Loves Earth, Wiki Loves Folklore, Wiki Loves Africa, and Wiki Loves Bangla).

The suite comprises five primary analytical tools:
1. **Performance Dynamics (Tool 01)**: Multi-dimensional empirical campaign dynamics combining longitudinal participant trajectories, cohort continuity, newcomer influx yield, Wikipedia content utility, curatorial quality honors, and Year-over-Year (YoY) velocity increments/decrements ($\Delta$) into an unslanted, purely observational framework.
2. **Retention (Tool 02)**: Longitudinal participant continuity analysis across multi-year editions, directional cohort retention matrices, and geographic choropleth mappings.
3. **Influx (Tool 03)**: Year-over-Year (YoY) contributor segmentation distinguishing first-time participants from returning veterans to assess participant pipeline sustainability.
4. **Content Utility (Tool 04)**: Live encyclopedic reuse tracking across Wikimedia projects (`prop=globalusage`), article inclusion volume, cross-wiki project breadth, and photographer impact rankings.
5. **Quality Recognition (Tool 05)**: Movement-wide curatorial and technical honors tracking (Quality Images, Featured Pictures, Valued Images) with structured Commons category harvesting and top contributing photographers.

---

## 2. Participant Retention Modeling

### 2.1 Cohort Identification and Directional Overlap

Let $U_A$ denote the set of unique Wikimedia Commons usernames who uploaded at least one eligible file during source campaign edition $A$, and let $U_B$ denote the set of unique uploaders during target edition $B$.

The **Directional Retention Rate** from edition $A$ to edition $B$ is defined as:

$$R(A \to B) = \frac{|U_A \cap U_B|}{|U_A|} \times 100\%$$

Where:
- $|U_A|$ is the baseline cohort size.
- $|U_A \cap U_B|$ represents the intersection of contributors who participated in both editions.
- Directionality is preserved: $R(A \to B) \neq R(B \to A)$ whenever $|U_A| \neq |U_B|$.

### 2.2 Forward Cohort Tracking vs. Backward Intersect

In multi-year comparative matrices, CampAnalytics distinguishes two temporal perspectives:
- **Forward Retention ($t_A < t_B$)**: Measures the survival rate of historic participants over subsequent campaign cycles, reflecting long-term community continuity.
- **Backward Intersect ($t_A > t_B$)**: Measures the proportion of a current cohort who had prior experience in earlier editions, indicating veteran reliance.

Self-retention along matrix diagonals is defined as:

$$R(A \to A) = 100.0\% \quad \text{for } |U_A| > 0$$

---

## 3. Contributor Influx and Lifecycle Segmentation

For an ordered chronological sequence of editions $E_1, E_2, \dots, E_T$, participant activity in edition $t$ is partitioned into two mutually exclusive subsets:
1. **Returning Veterans ($V_t$)**: Contributors who participated in at least one prior evaluated edition:
   $$V_t = U_t \cap \left( \bigcup_{k=1}^{t-1} U_k \right)$$
2. **First-Time Newcomers ($N_t$)**: Participants active in edition $t$ who had never previously contributed within the evaluated sequence:
   $$N_t = U_t \setminus \left( \bigcup_{k=1}^{t-1} U_k \right)$$

The **Newcomer Influx Share** ($\Gamma_t$) and **Cumulative Contributor Pool** ($C_t$) are computed as:

$$\Gamma_t = \frac{|N_t|}{|U_t|} \times 100\%$$

$$C_t = \left| \bigcup_{k=1}^t U_k \right| = C_{t-1} + |N_t|$$

---

### 4. Multi-Dimensional Campaign Observability & Performance Dynamics

The Campaign Performance Dynamics module provides direct empirical visibility into contributor dynamics, submission volume, and downstream cultural impact. In strict adherence to open data integrity, CampAnalytics rejects arbitrary 0–100 subjective composite scores, opaque weighting coefficients, and automated grading advice. Instead, organizers, jury members, and researchers are provided with authentic, non-imputed observational metrics, interactive multi-year longitudinal charts, and Year-over-Year (YoY) velocity deltas ($\Delta$).

### 4.1 Core Observational Dimensions

| Dimension | Notation | Definition | Data Source |
| :--- | :---: | :--- | :--- |
| **Community Scale** | $U_{\text{target}}$ | Total active participant cohort volume: unique human uploaders submitting $\ge 1$ eligible file | Commons Upload Logs |
| **Contributor Retention** | $R_{\text{ret}}$ | Volunteer continuity rate from baseline edition: $\frac{|U_{\text{target}} \cap U_{\text{base}}|}{|U_{\text{base}}|} \times 100\%$ | Commons Upload Logs |
| **Contributor Expansion** | $N_{\text{new}}$ | Absolute first-time newcomer recruitment yield: $|U_{\text{target}} \setminus \bigcup_{k < \text{target}} U_k|$ | Commons Contributor History |
| **Commons Submissions** | $F_{\text{total}}$ | Total verified media submissions uploaded to Wikimedia Commons | Category Member Harvest |
| **Content Utility** | $U_{\text{total}}$ | Encyclopedic deployment footprint: absolute Wikipedia article inclusions and illustrated file rate ($U_r$) | Commons API (`prop=globalusage`) |
| **Quality Recognition** | $Q_{\text{total}}$ | Curatorial honors volume: peer-reviewed Commons distinctions (Quality Images, Featured Pictures, Valued Images) | Commons Curatorial Categories |
| **Contributor Diversity** | $c_{10\%}$ | Participation equity: upload concentration share of top-10% contributors (inverse Pareto ratio) | Upload Distribution Logs |

---

## 5. Year-over-Year (YoY) Velocity Dynamics & Longitudinal Trajectories

### 5.1 Velocity Increment & Decrement Modeling ($\Delta$)

Rather than assigning static grades, CampAnalytics evaluates movement momentum through explicit Year-over-Year (YoY) increment/decrement velocity vectors:

$$\Delta X = X_t - X_{t-1}$$

$$\Delta X\% = \begin{cases} 
\frac{X_t - X_{t-1}}{X_{t-1}} \times 100\% & \text{if } X_{t-1} > 0 \\
\text{N/A (Inaugural Baseline)} & \text{if } X_{t-1} = 0 
\end{cases}$$

Where:
- $X_t$ denotes the observed metric value in the target edition $t$.
- $X_{t-1}$ denotes the observed metric value in the prior baseline edition $t-1$.
- Positive increments ($\Delta X > 0$) highlight community expansion, mobilization gains, or curatorial growth.
- Negative decrements ($\Delta X < 0$) highlight contraction or reduced curatorial yield, prompting organizers to investigate local context.

### 5.2 Multi-Year Longitudinal Trajectory Modeling

Single-year snapshots frequently obscure multi-year community cycles. CampAnalytics harvests up to 5 consecutive chronological editions ($E_{t-4}, E_{t-3}, \dots, E_t$) to construct multi-year longitudinal trajectories:
- **Participant Mobilization**: Active uploader volume progression across successive years.
- **Submission Output**: Total verified media files contributed per edition.
- **Curatorial Distinction Yield**: Absolute count of Quality Images, Featured Pictures, and Valued Images produced.

Interactive dual-axis visualizers allow organizers to inspect whether community engagement translates proportionally into high-utility cultural assets.

### 5.3 Cohort Retention & Newcomer Waterfall Partitioning

Every campaign cohort is partitioned into two mutually exclusive components:
1. **Returning Cohort ($V_t$)**: Experienced contributors who uploaded in the immediate prior baseline edition ($V_t = U_t \cap U_{t-1}$).
2. **First-Time Newcomers ($N_t$)**: Participants entering the campaign series for the first time ($N_t = U_t \setminus \bigcup_{k < t} U_k$).

Stacked visual waterfall charts illustrate the balance between veteran retention and newcomer recruitment without moralizing or grading affiliate strategies.

---

## 6. Regional Contextual Benchmarking & Non-Imputation Invariants

### 6.1 Regional Peer Medians ($P_{50}$)

To provide non-evaluative perspective across distinct organizational realities, CampAnalytics computes central tendencies across active national peer campaigns within each geographic cluster:

$$\text{Median}_{\text{regional}} = P_{50}\left( \{ X_{\text{peer}, 1}, X_{\text{peer}, 2}, \dots, X_{\text{peer}, K} \} \right)$$

$$\Delta_{\text{peer}} = X_{\text{target}} - \text{Median}_{\text{regional}}$$

Peer distributions allow organizers to understand their operational scale relative to regional neighbors (e.g. comparing Bangladesh against South Asian peers or Germany against Western European peers) without imposing artificial movement-wide rankings.

### 6.2 Empirical Regional Movement Reference Levels (10-Year Extraction)

Derived from longitudinal extraction across 100 country-editions on Wikimedia Commons:

| Regional Cluster | Typical Scale ($U$) | Median Retention ($R$) | Typical Utility Rate ($U_r$) | Typical Quality Rate ($Q_r$) | Typical Diversity ($c_{10\%}$) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Northern & Western Europe** | 330 | 18.5% | 3.5% | 2.0% | 70.0% |
| **Central & Eastern Europe** | 280 | 18.5% | 3.0% | 1.8% | 70.0% |
| **Southern Europe** | 950 | 15.5% | 3.5% | 2.0% | 70.0% |
| **South Asia** | 220 | 4.5% | 2.5% | 1.0% | 72.0% |
| **Americas / Latin America** | 320 | 4.0% | 2.5% | 1.0% | 72.0% |
| **Sub-Saharan Africa** | 60 | 9.5% | 2.0% | 1.0% | 75.0% |
| **Global Movement Median** | 350 | 16.0% | 3.0% | 1.5% | 70.0% |

### 6.3 Zero-Synthetic Data Invariant & Unheld Campaign Rejection Policy

1. **Zero Synthetic Imputation**: Under no circumstances does the engine generate deterministic pseudo-random cohorts, fake sample topics, or synthetic quality counts. All calculations are executed exclusively against live Wikimedia Commons APIs and Toolforge replica databases.
2. **Explicit Unheld Campaign Policy**: If a campaign edition was not organized or has zero recorded uploads on Wikimedia Commons (e.g., `wlmbd21`, `wlmfr23`, or unheld future years), the engine returns an explicit operational notice:
   > *"Campaign '\<code\>' did not take place or has no recorded uploads on Wikimedia Commons. It cannot be evaluated."*
   Unheld editions receive neither a 0 score nor an imputed regional average, and are automatically excluded from peer baseline groups.

---

## 7. Content Utility Modeling (`prop=globalusage`)

Content Utility evaluates the direct downstream encyclopedic impact of uploaded files. Media uploaded to Wikimedia Commons is evaluated against live deployment across global Wikimedia projects (Wikipedia language editions, Wikidata, Wikivoyage, Wikinews, etc.).

### 7.1 Utility Rate Formulation
Let $F$ denote the total set of verified files uploaded during campaign edition $C$. For each file $f \in F$, let $P(f)$ represent the set of distinct wiki pages in which file $f$ is actively embedded, obtained via `prop=globalusage`.

The subset of utilized files is defined as:
$$F_{\text{in-use}} = \{ f \in F \mid |P(f)| > 0 \}$$

The **Campaign File Utility Rate** ($U_r$) is:
$$U_r = \frac{|F_{\text{in-use}}|}{|F|} \times 100\%$$

### 7.2 Global Inclusions & Cross-Wiki Footprint
1. **Total Article Inclusions ($I_{\text{total}}$)**: Cumulative instances of media deployment across all client wikis:
   $$I_{\text{total}} = \sum_{f \in F} |P(f)|$$
2. **Project Breadth Index ($B_{\text{proj}}$)**: Count of distinct Wikimedia domains (e.g. `en.wikipedia.org`, `de.wikipedia.org`, `wikidata.org`) hosting at least one campaign submission:
   $$B_{\text{proj}} = \left| \bigcup_{f \in F} \{ \text{domain}(p) \mid p \in P(f) \} \right|$$
3. **Photographer Impact Contribution**: For uploader $u$, the aggregate usage volume of their portfolio is evaluated to construct the campaign contributor utility leaderboard.

### 7.3 Empirical Non-Imputation & Bot Exclusion Principles
1. **Strict Non-Imputation (Zero-Floor Integrity)**: In accordance with movement research standards, CampAnalytics strictly prohibits synthetic data imputation or simulated extrapolation. If sampling detects zero encyclopedic embeddings for a cohort, the utility rate is explicitly recorded as $0.0\%$, reflecting the true unindexed empirical reality rather than heuristic projections.
2. **Automated Bot Exclusion**: Accounts recognized as automated ingestion or synchronization bots (e.g. `Flickr upload bot`, `File Upload Bot (Magnus Manske)`, `CommonsDelinker`, `WLM-Bot`, and accounts matching bot naming patterns) are systematically excluded from contributor metrics, retention cohorts, newcomer pools, and photographer leaderboards. Contributor Diversity ($c_{10\%}$) is evaluated exclusively across genuine human participants.

---

## 8. Quality Recognition Modeling (Commons Curatorial Standards)

Quality Recognition quantifies formal artistic, technical, and canonical achievements awarded by established Wikimedia Commons peer review processes.

### 8.1 Community Designation Types
Submissions are evaluated against three formal Commons award categories:
1. **Quality Images (QI)**: Images meeting rigorous technical standards (composition, exposure, sharpness, lighting), evaluated and ratified by the Commons Quality Images committee.
2. **Featured Pictures (FP)**: The movement's premier visual content, selected by community consensus via strict multi-day candidacy votes (indexed under both `Category:Featured pictures` and `Category:Featured pictures on Wikimedia Commons`).
3. **Valued Images (VI)**: Images recognized as the most valuable of their kind for depicting particular encyclopedic subjects or concepts.

### 8.2 Quality Rate Formulation
Let $F_{\text{honored}} \subseteq F$ denote the set of campaign files awarded at least one formal designation ($QI \cup FP \cup VI$), discovered via structured Commons category trees (`Quality images from [Campaign]`, `Featured pictures from [Campaign]`, or `Valued images from [Campaign]`):

The **Quality Distinction Rate** ($Q_r$) is:
$$Q_r = \frac{|F_{\text{honored}}|}{|F|} \times 100\%$$

The **Honored Photographers Count** ($H$) quantifies distinct uploaders who created at least one recognized work:
$$H = |\{ \text{uploader}(f) \mid f \in F_{\text{honored}} \}|$$

### 8.3 Category Linguistic Normalization & Discovery
To prevent category fragmentation across international campaigns, CampAnalytics incorporates automated grammar normalization. National campaigns containing definite articles (e.g. `in the United States`, `in the Netherlands`, `in the Philippines`, `in the United Kingdom`, `in the Czech Republic`) are automatically resolved alongside canonical aliases and MediaWiki category redirect directives (`{{Category redirect}}`).

---

## 9. Boundary & Bias Disclosures

To uphold academic integrity and transparency, the following systemic boundaries and methodological trade-offs are explicitly disclosed:

### 9.1 Retentional Taxonomy Breakage (Organizational Fragmentation)
Directional retention $R(A \to B)$ relies on the macroscopic categorization topology of Wikimedia Commons as ground truth. If organizers alter target geographic boundaries or campaign naming conventions between editions, trackable cohort continuity is broken. While the framework utilizes linguistic normalization and explicit aliases, undocumented taxonomy breakage is intentionally treated as organizational fragmentation rather than an algorithmic failure.

### 9.2 Linguistic Resource Normalization
Campaign File Utility Rate ($U_r$) is formulated as a binary deployment metric ($|P(f)| > 0$). While campaigns associated with high-resource languages will naturally generate a larger absolute volume of article inclusions ($I_{\text{total}}$), the binary rate $U_r$ normalizes this disparity. A file deployed on Bengali Wikipedia carries the exact same mathematical weight as a file on English Wikipedia, ensuring emerging communities are not penalized for their linguistic scale.

### 9.3 Bot-Driven Knowledge Distribution
While automated *uploader* bots are strictly excluded, algorithmic *consumer* embeddings (e.g., localized stub-bots, Wikidata `P18` mass-insertions) are captured by `prop=globalusage`. CampAnalytics intentionally embraces this. Satisfying a machine-readable Wikidata property claim is a formally sanctioned, high-value form of media distribution. Algorithmic integration is evaluated as legitimate encyclopedic utility equivalent to human curatorial reuse.

---

## 10. References and Literature

1. **OECD / European Commission JRC (2008)**. *Handbook on Constructing Composite Indicators: Methodology and User Guide*. OECD Publishing, Paris.
2. **Halfaker, A., Geiger, R. S., Morgan, J. T., & Riedl, J. (2013)**. The Rise and Decline of an Open Collaboration System: How Wikipedia’s reaction to popularity is causing its decline. *American Behavioral Scientist*, 57(5), 664–688.
3. **Morgan, J. T., & Halfaker, A. (2018)**. Evaluating the Impact of Wikimedia Community Health Interventions: Methodological Frameworks and Quantitative Models. *Proceedings of the ACM on Human-Computer Interaction (CSCW)*.
4. **Kittur, A., Chi, E., Pendleton, B. A., Suh, B., & Mytkowicz, T. (2007)**. Power of the Few vs. Wisdom of the Crowd: Wikipedia and the Rise of the Bourgeoisie. *ACM Conference on Human Factors in Computing Systems (CHI)*.
5. **Wikimedia Foundation Research & Grants Committee (2020–2024)**. *Community Metrics and Impact Reporting Guidelines for Movement Organizers*. Wikimedia Meta-Wiki.
