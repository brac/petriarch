# BUGS

## Clicking in GPU mode doesn't register
Most of the time clicking the field while in gpu mode doesn't do anything. sometimes it does do the thing, like a food bloom but most of the time nothing happens. 

## Sawtoothing
I saw in the heap graph sawtooth patterns. We may need to optimize. CAn I view the same graphs in gpu mode as in cpu mode? I can get to the recordings in performance and memory but I had before a live heap size graph bar in one of these menus. Where was that? 

## Reproduction and Food availability
Agents are reproducing because they have enough food to reproduce but they do not have enough food to keep the new ones alive. I think they are diying immedieatly. Could we prevent reproduction if there is not enough food to support the offspring for at least a little time? 

## Small sizes dominate
The smaller sized agents always dominate eventually. I think this is because they can consume food more effeciently than the larger agents? How could we adjust that? 

## SPIKE: Do a study yourself
Using headless mode, run the simulation, look at the winners and losers and consider how we could adjust their weightings and genes to increase diversifacation amounts species while also increasing monoculture and monoethic society within the individual species. 

## Borders
There are clear borders in some cases. Could we have a display to only show those borders between societies?

## Ocean Activity
I panit a very wide ocean. Given enough time the agents seem to eat into the ocean. Why is that? I see that food is spawning in the ocean, perahps the agetns are being born in an ocean cell with food and can stay in there, repeat and slowly grow into the ocean. This is not intneded, there should be no food grown on the ocean. The ocean is a dead zone for food growth. 

