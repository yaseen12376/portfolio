"""The collection: one small model per project, kept under a glass bell jar.

Each piece is a module here (pieces/<project id>.py) with:

  META            id, the two lines printed on the paper tag, an accent colour
  build(col)      makes the model around the origin, standing on z = 0 (the
                  top of the turntable), inside kit.DISC_R and kit.ROOM_H.
                  Whatever it returns is handed back to animate().
  animate(t, st)  optional: secondary motion for t in [0, 1). It must return
                  to where it started at t = 1, so the loop has no seam.

The jar, its base, the tag, the lights and the camera are the same for every
piece (pieces/_kit.py), which is what lets a row of them sit on one shelf.
"""
