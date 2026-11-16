"""Just enough of Blender's mathutils to run art/nature/nature_models.py outside Blender."""
import math


class Vector:
    __slots__ = ('x', 'y', 'z')

    def __init__(self, v=(0.0, 0.0, 0.0)):
        self.x, self.y, self.z = (float(c) for c in v)

    def __iter__(self):
        return iter((self.x, self.y, self.z))

    def __getitem__(self, i):
        return (self.x, self.y, self.z)[i]

    def __len__(self):
        return 3

    def __add__(self, o):
        return Vector((self.x + o[0], self.y + o[1], self.z + o[2]))

    __radd__ = __add__

    def __sub__(self, o):
        return Vector((self.x - o[0], self.y - o[1], self.z - o[2]))

    def __rsub__(self, o):
        return Vector((o[0] - self.x, o[1] - self.y, o[2] - self.z))

    def __mul__(self, s):
        return Vector((self.x * s, self.y * s, self.z * s))

    __rmul__ = __mul__

    def __truediv__(self, s):
        return Vector((self.x / s, self.y / s, self.z / s))

    def __neg__(self):
        return Vector((-self.x, -self.y, -self.z))

    def dot(self, o):
        return self.x * o[0] + self.y * o[1] + self.z * o[2]

    def cross(self, o):
        return Vector((self.y * o[2] - self.z * o[1], self.z * o[0] - self.x * o[2], self.x * o[1] - self.y * o[0]))

    @property
    def length(self):
        return math.sqrt(self.dot(self))

    def normalized(self):
        l = self.length
        return self / l if l > 1e-12 else Vector(self)

    def normalize(self):
        n = self.normalized()
        self.x, self.y, self.z = n.x, n.y, n.z

    def lerp(self, o, t):
        return self + (Vector(o) - self) * t

    def copy(self):
        return Vector(self)

    def __repr__(self):
        return f'Vector(({self.x:.4f}, {self.y:.4f}, {self.z:.4f}))'


class Matrix:
    def __init__(self, rows):
        self.r = [list(map(float, row)) for row in rows]

    @staticmethod
    def Rotation(angle, size, axis):
        c, s = math.cos(angle), math.sin(angle)
        if axis == 'X':
            return Matrix([[1, 0, 0], [0, c, -s], [0, s, c]])
        if axis == 'Y':
            return Matrix([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        return Matrix([[c, -s, 0], [s, c, 0], [0, 0, 1]])

    def __matmul__(self, o):
        if isinstance(o, Matrix):
            return Matrix([[sum(self.r[i][k] * o.r[k][j] for k in range(3)) for j in range(3)] for i in range(3)])
        v = tuple(o)
        return Vector(tuple(sum(self.r[i][k] * v[k] for k in range(3)) for i in range(3)))
